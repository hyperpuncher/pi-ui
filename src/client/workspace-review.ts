import {
	CodeView,
	type CodeViewItem,
	type CodeViewOptions,
	type FileDiffMetadata,
	parsePatchFiles,
} from "@pierre/diffs";
import {
	getOrCreateWorkerPoolSingleton,
	terminateWorkerPoolSingleton,
} from "@pierre/diffs/worker";
import {
	type ContextMenuItem,
	type ContextMenuOpenContext,
	FileTree,
} from "@pierre/trees";

import { getPierreThemes, isPierreThemes, setActiveCodeTheme } from "../pierre-theme.ts";
import { isNumber, isRecord, isString } from "../utils/type-guards.ts";
import type { WorkspaceReviewComment } from "../workspace-review-comments.ts";
import { workspaceReviewTreeOptions } from "../workspace-review-tree.ts";
import {
	type WorkspaceCommitDetail,
	type WorkspaceFileChange,
	workspaceReviewHistoryPageSize,
	isWorkspaceReviewSnapshot,
	normalizeWorkspaceReviewPreferences,
	type WorkspaceReviewPreferences,
	type WorkspaceReviewSnapshot,
} from "../workspace-review-types.ts";
import { createWorkspaceFiles } from "./workspace-files.ts";
import { createWorkspaceReviewApi } from "./workspace-review-api.ts";
import {
	createWorkspaceReviewComments,
	type ReviewCommentMetadata,
} from "./workspace-review-comments.ts";
import {
	hideWorkspaceReviewDetailHeader,
	renderWorkspaceReviewHistory,
	showWorkspaceReviewDetailHeader,
} from "./workspace-review-history.ts";
import {
	appendHistoryPage,
	reconcileFirstHistoryPage,
	reconcileSelection,
	selectionForReviewOpen,
	type Selection,
	workspaceReviewLoading,
	workspaceReviewStateChanged,
} from "./workspace-review-state.ts";
import { syncWorkspaceTreePaths } from "./workspace-tree.ts";

type ReviewMode = NonNullable<WorkspaceReviewPreferences["mode"]>;
type ReviewItem = CodeViewItem<ReviewCommentMetadata> & { type: "diff" };
type DiffLayout = NonNullable<WorkspaceReviewPreferences["layout"]>;
type CommitView = { detail: WorkspaceCommitDetail; items: ReviewItem[] };

const diffListEndPadding = 10;
const workspaceGap = 2;
const codeThemeLight = document.body.dataset.codeThemeLight;
const codeThemeDark = document.body.dataset.codeThemeDark;
if (codeThemeLight && codeThemeDark) {
	setActiveCodeTheme({ dark: codeThemeDark, light: codeThemeLight });
}
const endpoint = document.body.dataset.workspaceReviewEndpoint ?? "";
const filesEndpoint = document.body.dataset.workspaceFilesEndpoint ?? "";
const api = createWorkspaceReviewApi(endpoint);

window.addEventListener("pi-ui-code-theme-changed", (event) => {
	if (!(event instanceof CustomEvent) || !isPierreThemes(event.detail)) return;
	const themes = event.detail;
	setActiveCodeTheme(themes);
	if (viewer) {
		void createWorkerPool()
			.setRenderOptions({ theme: themes })
			.then(updateViewerOptions)
			.catch((error) => console.error("Failed to update workspace theme", error));
	}
});

const app = requiredElement("app");
const modeButtons = document.querySelectorAll<HTMLButtonElement>("[data-workspace-mode]");
const treeHost = requiredElement("review-tree");
const history = requiredElement("review-history");
const detailHeader = requiredElement("review-detail-header");
const diffRoot = requiredElement("review-diff-view");
const fileTreeHost = requiredElement("workspace-file-tree");
const fileViewRoot = requiredElement("workspace-file-view");
const empty = requiredElement("review-empty");
const allButton = requiredButton("review-mode-all");
const selectedButton = requiredButton("review-mode-selected");
const splitButton = requiredButton("review-layout-split");
const stackedButton = requiredButton("review-layout-stacked");
const wrapButton = requiredButton("review-wrap");
const workspaceReviewRoot = requiredElement("workspace-review");
const submitCommentsButton = requiredButton("review-submit-comments");
const commentStatus = requiredElement("review-comment-status");
const dataRegion = requiredElement("workspace-review-data-region");
const data = requiredElement("workspace-review-data");

const initialData = JSON.parse(data.textContent ?? "");
if (
	!isRecord(initialData) ||
	!isNumber(initialData.filesRevision) ||
	!isNumber(initialData.treeRevision) ||
	!isString(initialData.workspacePath) ||
	!isWorkspaceReviewSnapshot(initialData.snapshot)
) {
	throw new Error("Invalid initial workspace review state");
}
const preferences = normalizeWorkspaceReviewPreferences(initialData.preferences);
let workspacePath = initialData.workspacePath;
let filesRevision = initialData.filesRevision;
let treeRevision = initialData.treeRevision;
let snapshot: WorkspaceReviewSnapshot = initialData.snapshot;
let historyCommits = [...snapshot.commits];
let historyHasMore = snapshot.commits.length === workspaceReviewHistoryPageSize;
let historyLoading = false;
let historyGeneration = 0;
let mode: ReviewMode = preferences.mode ?? "all";
let selection: Selection = { kind: "working", path: snapshot.changes[0]?.path };
let layout: DiffLayout | undefined = preferences.layout;
let wrap = preferences.wrap ?? true;
let version = 0;
const itemRevisions = new Map<string, { content: string; version: number }>();
let viewer: CodeView<ReviewCommentMetadata> | undefined;
let viewerCommentsEnabled: boolean | undefined;
const comments = createWorkspaceReviewComments({
	clearSelection: () => viewer?.clearSelectedLines(),
	onAnnotationsChange: updateWorkingAnnotations,
	onSubmitted() {
		workingItems = createItems(snapshot.changes, snapshot.patch, "working");
		if (selection.kind === "working") {
			items = workingItems;
			itemsByPath = itemMap(items);
			viewer?.clearSelectedLines();
			publish();
		}
		window.piUi.messageScroll.scrollBottom();
	},
	status: commentStatus,
	submit: submitWorkspaceReviewComments,
	submitButton: submitCommentsButton,
});
let workingItems = withWorkingAnnotations(
	createItems(snapshot.changes, snapshot.patch, "working"),
);
let items = workingItems;
let itemsByPath = itemMap(items);
let initializedSelection = snapshot.revision !== "git-unloaded";
const commitCache = new Map<string, CommitView>();
const commitRequests = new Map<string, Promise<CommitView | undefined>>();
let workspaceVersion = 0;
const workspaceFiles = createWorkspaceFiles({
	endpoint: filesEndpoint,
	initialGitStatus: snapshot.changes,
	initialWorkspacePath: workspacePath,
});
let preferredPanelMode: "files" | "git" | undefined = preferences.tab;
let panelMode = initialPanelMode(preferredPanelMode, snapshot.isGitRepository);

const visibility = createVisibility(app, true, (open) => {
	workspaceFiles.setVisible(open && panelMode === "files");
	if (open && panelMode === "git") openGitView();
});
for (const button of modeButtons) {
	button.addEventListener("click", () => {
		const mode = button.dataset.workspaceMode;
		if (mode === "files" || (mode === "git" && snapshot.isGitRepository)) {
			setPanelMode(mode);
		}
	});
}

const tree = new FileTree({
	...workspaceReviewTreeOptions,
	composition: {
		contextMenu: {
			enabled: true,
			render: renderReviewContextMenu,
			triggerMode: "right-click",
		},
	},
	gitStatus: snapshot.changes,
	paths: snapshot.changes.map(({ path }) => path),
	onSelectionChange(paths) {
		const path = paths.length === 1 ? paths[0] : undefined;
		if (path) selectWorking(path, true);
	},
});
tree.render({ containerWrapper: treeHost });
bindWorkspaceKeyboardNavigation();
window.piUi.workspaceReview = {
	...visibility,
	focusEditor,
	focusFiles,
	focusGit,
};

history.addEventListener("scroll", maybeLoadOlderHistory, { passive: true });
history.addEventListener("keydown", handleHistoryKeydown);
allButton.addEventListener("click", () => setMode("all"));
selectedButton.addEventListener("click", () => setMode("selected"));
splitButton.addEventListener("click", () => setLayout("split"));
stackedButton.addEventListener("click", () => setLayout("unified"));
wrapButton.addEventListener("click", () => {
	wrap = !wrap;
	wrapButton.setAttribute("aria-pressed", String(wrap));
	writePreferences();
	updateViewerOptions();
});
let observedDiffLayout = effectiveLayout();
const resize = new ResizeObserver(() => {
	const nextLayout = effectiveLayout();
	syncLayoutButtons(nextLayout);
	if (nextLayout === observedDiffLayout) return;
	observedDiffLayout = nextLayout;
	updateViewerOptions();
});
resize.observe(diffRoot);

const theme = new MutationObserver(updateViewerOptions);
theme.observe(document.documentElement, {
	attributeFilter: ["class"],
	attributes: true,
});

function applyWorkspaceReviewData(): void {
	try {
		const currentData = document.getElementById("workspace-review-data");
		const value = JSON.parse(currentData?.textContent ?? "");
		if (
			isRecord(value) &&
			isNumber(value.filesRevision) &&
			isNumber(value.treeRevision) &&
			isString(value.workspacePath) &&
			isWorkspaceReviewSnapshot(value.snapshot)
		) {
			const filesChanged =
				value.workspacePath === workspacePath &&
				value.filesRevision !== filesRevision;
			const treeChanged = value.treeRevision !== treeRevision;
			filesRevision = value.filesRevision;
			treeRevision = value.treeRevision;
			applyWorkspaceReview(value.workspacePath, value.snapshot);
			if (filesChanged) workspaceFiles.refresh(treeChanged);
		}
	} catch {
		// A later stream morph can replace an incomplete payload.
	}
}

const reviewData = new MutationObserver(applyWorkspaceReviewData);
reviewData.observe(dataRegion, {
	characterData: true,
	childList: true,
	subtree: true,
});

syncModeButtons();
syncLayoutButtons();
wrapButton.setAttribute("aria-pressed", String(wrap));
applySnapshot(snapshot);
applyWorkspaceReviewData();

window.addEventListener(
	"pagehide",
	() => {
		reviewData.disconnect();
		resize.disconnect();
		theme.disconnect();
		tree.cleanUp();
		workspaceFiles.cleanUp();
		viewer?.cleanUp();
		terminateWorkerPoolSingleton();
	},
	{ once: true },
);

function applyWorkspaceReview(
	nextWorkspacePath: string,
	next: WorkspaceReviewSnapshot,
): void {
	if (
		!workspaceReviewStateChanged(
			{ revision: snapshot.revision, workspacePath },
			{ revision: next.revision, workspacePath: nextWorkspacePath },
		)
	) {
		return;
	}
	const workspaceChanged = nextWorkspacePath !== workspacePath;
	if (workspaceChanged) {
		workspacePath = nextWorkspacePath;
		workspaceFiles.setWorkspace(workspacePath);
		workspaceVersion++;
		historyGeneration++;
		historyCommits = [];
		historyHasMore = false;
		historyLoading = false;
		commitCache.clear();
		commitRequests.clear();
		itemRevisions.clear();
		comments.reset();
		initializedSelection = false;
		selection = { kind: "working" };
	}
	applySnapshot(next);
}

function applySnapshot(next: WorkspaceReviewSnapshot): void {
	const wasUnloaded =
		workspaceReviewLoading(snapshot.revision) || !initializedSelection;
	const previousPaths = wasUnloaded
		? undefined
		: snapshot.changes.map(({ path }) => path);
	const gitWasAvailable = snapshot.isGitRepository;
	const historyState = reconcileFirstHistoryPage(
		historyCommits,
		historyHasMore,
		next.commits,
	);
	snapshot = next;
	workspaceFiles.setGitStatus(snapshot.changes);
	historyCommits = historyState.commits;
	historyHasMore = historyState.hasMore;
	if (historyState.reset) {
		historyGeneration++;
		historyLoading = false;
	}
	if (!snapshot.isGitRepository) panelMode = "files";
	else if (!gitWasAvailable && preferredPanelMode !== "files") panelMode = "git";
	workspaceFiles.setVisible(visibility.isOpen() && panelMode === "files");
	const nextWorkingItems = createItems(snapshot.changes, snapshot.patch, "working");
	comments.reconcileItems(nextWorkingItems);
	workingItems = withWorkingAnnotations(nextWorkingItems);
	syncWorkspaceTreePaths(
		tree,
		previousPaths,
		snapshot.changes.map(({ path }) => path),
	);
	tree.setGitStatus(snapshot.changes);
	if (workspaceReviewLoading(snapshot.revision)) {
		initializedSelection = false;
		renderHistory();
		viewer?.setItems([]);
		showEmpty("Loading Git data…");
		return;
	}

	selection = reconcileSelection(
		selection,
		wasUnloaded,
		preferredWorkingChanges(),
		snapshot.commits,
	);
	if (wasUnloaded) initializedSelection = true;

	renderHistory();
	if (visibility.isOpen() && panelMode === "git") {
		requestAnimationFrame(maybeLoadOlderHistory);
	}
	if (selection.kind === "commit") {
		void activateCommit(selection.hash, selection.path);
	} else activateWorking(selection.path);
}

function setMode(next: ReviewMode): void {
	mode = next;
	syncModeButtons();
	writePreferences();
	if (mode === "selected" && !selection.path) {
		selection.path = items[0]?.fileDiff.name;
	}
	renderHistory();
	publish();
}

function setLayout(next: DiffLayout): void {
	layout = next;
	observedDiffLayout = effectiveLayout();
	syncLayoutButtons(observedDiffLayout);
	writePreferences();
	updateViewerOptions();
}

function selectWorking(path?: string, fromTree = false): void {
	activateWorking(path);
	renderHistory();
	if (path && !fromTree) {
		tree.scrollToPath(path, { focus: false, offset: "nearest" });
	}
	if (path) scrollToPath(path);
}

function activateWorking(path?: string): void {
	selection = { kind: "working", path };
	items = workingItems;
	itemsByPath = itemMap(items);
	hideDetailHeader();
	publish();
}

async function activateCommit(hash: string, path?: string): Promise<void> {
	selection = { hash, kind: "commit", path };
	clearTreeSelection();
	renderHistory();
	const cached = commitCache.get(hash);
	if (cached) {
		applyCommitView(cached, path);
		return;
	}
	showEmpty("Loading commit…");
	const view = await loadCommit(hash);
	if (selection.kind !== "commit" || selection.hash !== hash) return;
	if (!view) {
		showEmpty("Unable to load commit");
		return;
	}
	applyCommitView(view, path);
}

function applyCommitView(view: CommitView, path?: string): void {
	items = view.items;
	itemsByPath = itemMap(items);
	selection = {
		hash: view.detail.commit.hash,
		kind: "commit",
		path: path && itemsByPath.has(path) ? path : items[0]?.fileDiff.name,
	};
	renderDetailHeader(view.detail);
	renderHistory();
	publish();
}

function loadCommit(hash: string): Promise<CommitView | undefined> {
	const existing = commitRequests.get(hash);
	if (existing) return existing;
	const requestedWorkspaceVersion = workspaceVersion;
	const request = api
		.loadCommit(hash)
		.then((detail) => {
			if (!detail) return undefined;
			const view = {
				detail,
				items: createItems(detail.changes, detail.patch, detail.commit.hash),
			};
			if (requestedWorkspaceVersion !== workspaceVersion) return undefined;
			commitCache.set(hash, view);
			return view;
		})
		.finally(() => commitRequests.delete(hash));
	commitRequests.set(hash, request);
	return request;
}

function selectCommitPath(hash: string, path: string): void {
	if (selection.kind !== "commit" || selection.hash !== hash) return;
	selection.path = path;
	renderHistory();
	if (mode === "selected") publish();
	else scrollToPath(path);
}

function scrollToPath(path: string): void {
	const item = itemsByPath.get(path);
	if (item && viewer) {
		viewer.scrollTo({
			type: "item",
			id: item.id,
			align: "start",
			behavior: "smooth-auto",
		});
	}
}

function preferredWorkingChanges(): readonly WorkspaceFileChange[] {
	const changedPaths = new Set(snapshot.changes.map(({ path }) => path));
	const firstPath = tree
		.getVisibleRows(0, tree.getVisibleCount())
		.find((row) => row.kind === "file" && changedPaths.has(row.path))?.path;
	if (!firstPath || firstPath === snapshot.changes[0]?.path) return snapshot.changes;
	const first = snapshot.changes.find(({ path }) => path === firstPath);
	return first
		? [first, ...snapshot.changes.filter(({ path }) => path !== firstPath)]
		: snapshot.changes;
}

function clearTreeSelection(): void {
	for (const path of tree.getSelectedPaths()) tree.getItem(path)?.deselect();
}

function publish(): void {
	const visible =
		mode === "all"
			? items
			: selection.path && itemsByPath.has(selection.path)
				? [itemsByPath.get(selection.path)!]
				: [];
	if (visible.length === 0) {
		viewer?.setItems([]);
		showEmpty(emptyMessage());
		return;
	}
	showEmpty();
	if (!visibility.isOpen()) return;
	if (!viewer) {
		observedDiffLayout = effectiveLayout();
		const options = viewerOptions();
		viewer = new CodeView(options, createWorkerPool());
		viewerCommentsEnabled = options.enableGutterUtility;
		viewer.setup(diffRoot);
	} else if (viewerCommentsEnabled !== canAddComments()) {
		updateViewerOptions();
	}
	viewer.setItems(visible);
}

function createItems(
	changes: readonly WorkspaceFileChange[],
	patch: string,
	source: string,
): ReviewItem[] {
	const parsed = new Map<string, FileDiffMetadata>();
	for (const patchFile of parsePatchFiles(patch)) {
		for (const file of patchFile.files) parsed.set(file.name, file);
	}
	return changes.map((change) => {
		const parsedFile = parsed.get(change.path) ?? emptyDiff(change);
		const key = `${source}:${change.path}`;
		const content = JSON.stringify({ ...parsedFile, cacheKey: undefined });
		const previous = itemRevisions.get(key);
		const itemVersion = previous?.content === content ? previous.version : ++version;
		itemRevisions.set(key, { content, version: itemVersion });
		return {
			// Cache identity follows content; unchanged files keep their revision.
			fileDiff: { ...parsedFile, cacheKey: `pi-ui:${key}:${itemVersion}` },
			id: `diff:${key}`,
			type: "diff",
			version: itemVersion,
		};
	});
}

function withWorkingAnnotations(value: readonly ReviewItem[]): ReviewItem[] {
	return value.map((item) => ({
		...item,
		annotations: comments.annotations.get(item.fileDiff.name),
	}));
}

function itemMap(value: readonly ReviewItem[]): Map<string, ReviewItem> {
	return new Map(value.map((item) => [item.fileDiff.name, item]));
}

function emptyDiff(change: WorkspaceFileChange): FileDiffMetadata {
	return {
		additionLines: [],
		deletionLines: [],
		hunks: [],
		isPartial: true,
		name: change.path,
		splitLineCount: 0,
		type:
			change.status === "added" || change.status === "untracked"
				? "new"
				: change.status === "deleted"
					? "deleted"
					: change.status === "renamed"
						? "rename-pure"
						: "change",
		unifiedLineCount: 0,
	};
}

function renderHistory(): void {
	renderWorkspaceReviewHistory({
		commits: historyCommits,
		getCommitDetail: (hash) => commitCache.get(hash)?.detail,
		history,
		loading: historyLoading,
		onSelectCommit: (hash) => void activateCommit(hash),
		onSelectCommitPath: selectCommitPath,
		revision: snapshot.revision,
		selection,
	});
}

function maybeLoadOlderHistory(): void {
	if (
		!visibility.isOpen() ||
		historyLoading ||
		!historyHasMore ||
		history.scrollHeight - history.scrollTop - history.clientHeight > 120
	) {
		return;
	}
	void loadOlderHistory();
}

async function loadOlderHistory(): Promise<void> {
	historyLoading = true;
	const generation = historyGeneration;
	renderHistory();
	const commits = await api.loadHistory(historyCommits.length);
	if (generation !== historyGeneration) return;
	if (commits) {
		const next = appendHistoryPage(historyCommits, commits);
		historyCommits = next.commits;
		historyHasMore = next.hasMore;
	} else {
		historyHasMore = false;
	}
	historyLoading = false;
	renderHistory();
	requestAnimationFrame(maybeLoadOlderHistory);
}

function renderDetailHeader(detail: CommitView["detail"]): void {
	showWorkspaceReviewDetailHeader(detailHeader, detail);
}

function hideDetailHeader(): void {
	hideWorkspaceReviewDetailHeader(detailHeader);
}

function canAddComments(): boolean {
	return selection.kind === "working" && comments.canAdd();
}

function updateViewerOptions(): void {
	if (!viewer) return;
	const options = viewerOptions();
	viewer.setOptions(options);
	viewerCommentsEnabled = options.enableGutterUtility;
}

function viewerOptions(): CodeViewOptions<ReviewCommentMetadata, undefined> {
	const commentsEnabled = canAddComments();
	return {
		diffIndicators: "none",
		enableGutterUtility: commentsEnabled,
		enableLineSelection: commentsEnabled,
		onGutterUtilityClick(range, context) {
			if (context.item.type === "diff") comments.add(context.item, range);
		},
		pointerEventsOnScroll: true,
		renderAnnotation: comments.render,
		diffStyle: effectiveLayout(),
		hunkSeparators: "simple",
		itemMetrics: { diffHeaderHeight: 36, paddingBottom: 0, spacing: 0 },
		layout: {
			gap: workspaceGap,
			paddingBottom: diffListEndPadding,
			paddingTop: 0,
		},
		lineHoverHighlight: "both",
		overflow: wrap ? "wrap" : "scroll",
		stickyHeaders: true,
		theme: getPierreThemes(),
		themeType: document.documentElement.classList.contains("dark") ? "dark" : "light",
		unsafeCSS: `
			:host {
				--diffs-bg: var(--surface-code);
				--diffs-dark-bg: var(--surface-code);
				--diffs-bg-selection-override: var(--selection);
				--diffs-bg-selection-number-override: var(--selection);
				--diffs-editor-selection-bg: var(--selection);
				--diffs-font-family: var(--font-mono);
				--diffs-gap-block: 0px;
				--diffs-gap-style: 0 solid transparent;
				--diffs-header-font-family: var(--font-sans);
				--diffs-light-bg: var(--surface-code);
				--diffs-scrollbar-gutter-override: 0px;
			}

			::selection {
				background: var(--selection);
				color: currentColor;
			}

			[data-diffs-header="default"] {
				min-height: 36px;
				padding-inline: 12px;
			}

			[data-diffs-header="default"] :is([data-title], [data-prev-name]) {
				font-family: var(--font-mono);
				font-weight: 500;
			}

			[data-diffs-header="default"] [data-metadata],
			[data-diffs-header="default"] [data-additions-count],
			[data-diffs-header="default"] [data-deletions-count] {
				font-family: var(--font-mono);
				font-size: 10px;
				font-variant-numeric: tabular-nums;
				font-weight: 500;
			}

			[data-diffs-header="default"] [data-additions-count] {
				order: 1;
			}

			[data-diffs-header="default"] [data-deletions-count] {
				order: 2;
			}

			[data-diffs-header="default"] [data-metadata] slot {
				order: 3;
			}

			[data-code] {
				padding-bottom: 0;
			}

			[data-annotation-content] {
				min-width: 0;
			}

		`,
	};
}

function createWorkerPool() {
	return getOrCreateWorkerPoolSingleton({
		highlighterOptions: {
			langs: ["text"],
			preferredHighlighter: "shiki-js",
			theme: getPierreThemes(),
			useTokenTransformer: true,
		},
		poolOptions: {
			poolSize: 1,
			totalASTLRUCacheSize: 100,
			workerFactory: () =>
				new Worker(new URL("../pierre-worker.js", import.meta.url), {
					type: "module",
				}),
		},
	});
}

function initialPanelMode(
	preferred: WorkspaceReviewPreferences["tab"],
	gitAvailable: boolean,
): "files" | "git" {
	return gitAvailable && preferred !== "files" ? "git" : "files";
}

function setPanelMode(next: "files" | "git"): void {
	if (next === panelMode || (next === "git" && !snapshot.isGitRepository)) return;
	panelMode = next;
	preferredPanelMode = next;
	writePreferences();
	if (!visibility.isOpen()) return;
	workspaceFiles.setVisible(next === "files");
	if (next === "git") openGitView();
}

export async function openLinkedWorkspaceFile(
	path: string,
	linkedWorkspacePath: string,
): Promise<void> {
	if (linkedWorkspacePath !== workspacePath)
		throw new Error("The workspace changed. Open the file link again.");
	visibility.open();
	setPanelMode("files");
	await workspaceFiles.openFile(path);
	focusAfterOpen(() => workspaceFiles.focusEditor());
}

function focusFiles(): void {
	visibility.open();
	setPanelMode("files");
	focusAfterOpen(() => workspaceFiles.focusTree());
}

function focusGit(): void {
	if (!snapshot.isGitRepository) return;
	visibility.open();
	setPanelMode("git");
	focusAfterOpen(() => {
		if (selection.kind === "commit" || snapshot.changes.length === 0) {
			focusHistoryCommit();
			return;
		}
		const path =
			tree.getSelectedPaths()[0] ??
			tree.getFocusedPath() ??
			snapshot.changes[0]?.path;
		if (path) tree.scrollToPath(path, { focus: true });
		requestAnimationFrame(() => {
			const container = treeHost.querySelector("file-tree-container");
			const root =
				container?.shadowRoot?.querySelector<HTMLElement>('[role="tree"]');
			(root ?? treeHost).focus({ preventScroll: true });
		});
	});
}

function historyCommitButtons(): HTMLButtonElement[] {
	return [...history.querySelectorAll<HTMLButtonElement>(".review-commit")];
}

function focusHistoryCommit(): void {
	const button =
		history.querySelector<HTMLButtonElement>('.review-commit[aria-pressed="true"]') ??
		historyCommitButtons()[0];
	(button ?? history).focus({ preventScroll: true });
	button?.scrollIntoView({ block: "nearest" });
}

function handleHistoryKeydown(event: KeyboardEvent): void {
	if (
		event.defaultPrevented ||
		event.altKey ||
		event.ctrlKey ||
		event.metaKey ||
		event.shiftKey ||
		!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.code)
	) {
		return;
	}
	const buttons = historyCommitButtons();
	if (buttons.length === 0) return;
	const current =
		event.target instanceof HTMLButtonElement ? buttons.indexOf(event.target) : -1;
	let index = current;
	if (event.code === "ArrowDown") index = Math.min(current + 1, buttons.length - 1);
	if (event.code === "ArrowUp")
		index = current < 0 ? buttons.length - 1 : Math.max(0, current - 1);
	if (event.code === "Home") index = 0;
	if (event.code === "End") index = buttons.length - 1;
	const button = buttons[index];
	if (!button) return;
	event.preventDefault();
	button.click();
	requestAnimationFrame(focusHistoryCommit);
}

function focusEditor(): void {
	visibility.open();
	focusAfterOpen(() => {
		if (panelMode === "files") workspaceFiles.focusEditor();
		else diffRoot.focus({ preventScroll: true });
	});
}

function focusAfterOpen(focus: () => void): void {
	requestAnimationFrame(() => requestAnimationFrame(focus));
}

function bindWorkspaceKeyboardNavigation(): void {
	workspaceReviewRoot.addEventListener("keydown", (event) => {
		if (
			event.defaultPrevented ||
			event.isComposing ||
			event.altKey ||
			event.ctrlKey ||
			event.metaKey ||
			event.shiftKey ||
			(event.code !== "KeyJ" && event.code !== "KeyK")
		) {
			return;
		}
		const path = event.composedPath();
		if (path.some(isTextInput)) return;
		const arrow = event.code === "KeyJ" ? "ArrowDown" : "ArrowUp";

		if (path.includes(history)) {
			event.preventDefault();
			path[0]?.dispatchEvent(
				new KeyboardEvent("keydown", {
					bubbles: true,
					code: arrow,
					key: arrow,
				}),
			);
			return;
		}

		if (path.some((target) => target === treeHost || target === fileTreeHost)) {
			event.preventDefault();
			path[0]?.dispatchEvent(
				new KeyboardEvent("keydown", {
					bubbles: true,
					code: arrow,
					composed: true,
					key: arrow,
				}),
			);
			return;
		}

		const scrollPane = path.includes(fileViewRoot)
			? fileViewRoot
			: path.includes(diffRoot)
				? diffRoot
				: undefined;
		if (!scrollPane) return;
		event.preventDefault();
		scrollPane.scrollBy({
			behavior: "smooth",
			top: event.code === "KeyJ" ? 100 : -100,
		});
	});
}

function isTextInput(target: EventTarget | undefined): boolean {
	return (
		target instanceof HTMLInputElement ||
		target instanceof HTMLTextAreaElement ||
		target instanceof HTMLSelectElement ||
		(target instanceof HTMLElement && target.isContentEditable)
	);
}

function renderReviewContextMenu(
	item: ContextMenuItem,
	context: ContextMenuOpenContext,
): HTMLElement | null {
	if (item.kind !== "file") return null;
	const menu = document.createElement("div");
	menu.className = "workspace-tree-context-menu";
	menu.setAttribute("role", "menu");
	const open = document.createElement("button");
	open.type = "button";
	open.className = "workspace-tree-context-menu-item";
	open.setAttribute("role", "menuitem");
	open.textContent = "Open in editor";
	open.addEventListener("click", () => {
		context.close({ restoreFocus: false });
		setPanelMode("files");
		void workspaceFiles.openFile(item.path);
	});
	const discard = document.createElement("button");
	discard.type = "button";
	discard.className =
		"workspace-tree-context-menu-item workspace-tree-context-menu-item-destructive";
	discard.setAttribute("role", "menuitem");
	discard.textContent = "Discard changes";
	discard.addEventListener("click", () => {
		context.close({ restoreFocus: false });
		void discardReviewChange(item.path);
	});
	menu.append(open, discard);
	return menu;
}

async function discardReviewChange(path: string): Promise<void> {
	const change = snapshot.changes.find((entry) => entry.path === path);
	if (!change) return;
	const confirmed = await workspaceFiles.requestConfirmation({
		title: "Discard changes?",
		description:
			change.status === "untracked"
				? `${path} is untracked and will be permanently deleted. This action cannot be undone.`
				: `All changes to ${path} will be permanently discarded. This action cannot be undone.`,
		action: "Discard",
	});
	if (!confirmed) return;
	try {
		await api.discard(path);
		workspaceFiles.refreshAfterDiscard(path);
	} catch (error) {
		await workspaceFiles.requestNotice(
			"Could not discard changes",
			String(error).replace(/^Error: /, ""),
		);
	}
}

function openGitView(): void {
	const nextSelection = selectionForReviewOpen(selection, preferredWorkingChanges());
	if (nextSelection !== selection && nextSelection.kind === "working") {
		selectWorking(nextSelection.path);
	}
	if (snapshot.revision === "git-unloaded") showEmpty("Loading Git data…");
	else {
		requestAnimationFrame(() => {
			publish();
			maybeLoadOlderHistory();
		});
	}
}

function createVisibility(
	app: HTMLElement,
	initiallyAvailable: boolean,
	onChange: (open: boolean) => void,
) {
	let available = initiallyAvailable;
	let open = false;
	const syncAvailability = () => {
		const button = document.querySelector<HTMLElement>(
			'[data-pi-ui-action="review"]',
		);
		if (!button) return;
		button.inert = !available;
		button.style.visibility = available ? "visible" : "hidden";
	};
	const requestOpen = (next: boolean) => {
		app.dispatchEvent(
			new CustomEvent("pi-ui-workspace-review-open", {
				detail: { open: available && next },
			}),
		);
	};
	const applyOpen = (next: boolean) => {
		if (next && !available) {
			requestOpen(false);
			return;
		}
		const wasOpen = open;
		open = next;
		if (open !== wasOpen) onChange(open);
	};
	syncAvailability();
	applyOpen(app.classList.contains("review-open"));
	return {
		applyOpen,
		isAvailable: () => available,
		isOpen: () => open,
		open: () => requestOpen(true),
		setAvailable(next: boolean) {
			available = next;
			syncAvailability();
			if (!available) requestOpen(false);
		},
	};
}

function syncModeButtons(): void {
	allButton.setAttribute("aria-pressed", String(mode === "all"));
	selectedButton.setAttribute("aria-pressed", String(mode === "selected"));
}

function effectiveLayout(): DiffLayout {
	if (diffRoot.clientWidth < 720) return "unified";
	return layout ?? "split";
}

function syncLayoutButtons(currentLayout = effectiveLayout()): void {
	const split = currentLayout === "split";
	splitButton.setAttribute("aria-pressed", String(split));
	stackedButton.setAttribute("aria-pressed", String(!split));
}

function emptyMessage(): string {
	if (workspaceReviewLoading(snapshot.revision)) return "Loading Git data…";
	if (!snapshot.isGitRepository) return "Open a Git repository";
	if (selection.kind === "commit") return "This commit has no file changes";
	if (snapshot.changes.length === 0) return "Working tree clean";
	return "No changes to display";
}

function showEmpty(message?: string): void {
	empty.style.display = message ? "grid" : "none";
	if (message) empty.textContent = message;
}

function writePreferences(): void {
	writeWorkspaceReviewPreferences({
		layout,
		mode,
		tab: preferredPanelMode,
		wrap,
	});
}

function submitWorkspaceReviewComments(
	comments: readonly WorkspaceReviewComment[],
): Promise<boolean> {
	return new Promise((resolve) => {
		const timeout = setTimeout(() => resolve(false), 10_000);
		window.addEventListener(
			"pi-ui-workspace-review-submitted",
			() => {
				clearTimeout(timeout);
				resolve(true);
			},
			{ once: true },
		);
		document.body.dispatchEvent(
			new CustomEvent("pi-ui-workspace-review-submit", {
				detail: { comments },
			}),
		);
	});
}

function writeWorkspaceReviewPreferences(value: WorkspaceReviewPreferences): void {
	document.body.dispatchEvent(
		new CustomEvent("pi-ui-workspace-review-preferences", { detail: value }),
	);
}

function updateWorkingAnnotations(path: string): void {
	const index = workingItems.findIndex((item) => item.fileDiff.name === path);
	if (index < 0) return;
	const next = [...workingItems];
	next[index] = {
		...next[index],
		annotations: comments.annotations.get(path),
		version: ++version,
	};
	workingItems = next;
	if (selection.kind === "working") {
		items = workingItems;
		itemsByPath = itemMap(items);
		publish();
	}
}

function requiredElement(id: string): HTMLElement {
	const element = document.getElementById(id);
	if (!(element instanceof HTMLElement)) throw new Error(`Missing #${id}`);
	return element;
}

function requiredButton(id: string): HTMLButtonElement {
	const element = document.getElementById(id);
	if (!(element instanceof HTMLButtonElement)) {
		throw new Error(`Missing #${id}`);
	}
	return element;
}
