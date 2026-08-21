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
import { FileTree } from "@pierre/trees";

import { getPierreThemes, isPierreThemes, setActiveCodeTheme } from "../pierre-theme.ts";
import { isRecord } from "../utils/type-guards.ts";
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
	bindWorkspaceReviewLayout,
	workspaceGap,
	workspaceStructuralGap,
} from "./workspace-review-layout.ts";
import {
	appendHistoryPage,
	reconcileFirstHistoryPage,
	reconcileSelection,
	selectionForReviewOpen,
	type Selection,
} from "./workspace-review-state.ts";

type ReviewMode = NonNullable<WorkspaceReviewPreferences["mode"]>;
type ReviewItem = CodeViewItem<ReviewCommentMetadata> & { type: "diff" };
type DiffLayout = NonNullable<WorkspaceReviewPreferences["layout"]>;
type CommitView = { detail: WorkspaceCommitDetail; items: ReviewItem[] };

const diffListEndPadding = 10;
const codeThemeLight = document.body.dataset.codeThemeLight;
const codeThemeDark = document.body.dataset.codeThemeDark;
if (codeThemeLight && codeThemeDark) {
	setActiveCodeTheme({ dark: codeThemeDark, light: codeThemeLight });
}
const endpoint = document.body.dataset.workspaceReviewEndpoint ?? "";
const api = createWorkspaceReviewApi(endpoint);

window.addEventListener("pi-ui-code-theme-changed", (event) => {
	if (!(event instanceof CustomEvent) || !isPierreThemes(event.detail)) return;
	const themes = event.detail;
	setActiveCodeTheme(themes);
	if (viewer) {
		viewer.setOptions(viewerOptions());
		viewer.setItems(
			mode === "all"
				? items
				: selection.path && itemsByPath.has(selection.path)
					? [itemsByPath.get(selection.path)!]
					: [],
		);
	}
});

const root = requiredElement("workspace-review");
const app = requiredElement("app");
const workspaceShell = requiredElement("workspace-shell");
const chat = requiredElement("chat-pane");
const reviewBody = requiredElement("review-body");
const treeHost = requiredElement("review-file-tree");
const treeEmpty = requiredElement("review-tree-empty");
const changesSection = requiredElement("review-changes-section");
const changesSeparator = requiredElement("review-changes-separator");
const gitSeparator = requiredElement("review-git-separator");
const sidebarSeparator = requiredElement("review-sidebar-separator");
const history = requiredElement("review-history");
const detailHeader = requiredElement("review-detail-header");
const diffRoot = requiredElement("review-diff-view");
const empty = requiredElement("review-empty");
const branch = requiredElement("review-branch");
const count = requiredElement("review-change-count");
const additions = requiredElement("review-total-additions");
const deletions = requiredElement("review-total-deletions");
const allButton = requiredButton("review-mode-all");
const selectedButton = requiredButton("review-mode-selected");
const splitButton = requiredButton("review-layout-split");
const stackedButton = requiredButton("review-layout-stacked");
const wrapButton = requiredButton("review-wrap");
const submitCommentsButton = requiredButton("review-submit-comments");
const commentStatus = requiredElement("review-comment-status");
const data = requiredElement("workspace-review-data");

const initialData = JSON.parse(data.textContent ?? "");
if (!isRecord(initialData) || !isWorkspaceReviewSnapshot(initialData.snapshot)) {
	throw new Error("Invalid initial workspace review state");
}
const preferences = normalizeWorkspaceReviewPreferences(initialData.preferences);
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
	submit: api.submitComments,
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

const reviewLayout = bindWorkspaceReviewLayout({
	app: workspaceShell,
	changesSection,
	changesSeparator,
	chat,
	gitSeparator,
	hasChanges: () => snapshot.changes.length > 0,
	onCommit: (values) =>
		writeWorkspaceReviewPreferences({ layout, mode, wrap, ...values }),
	preferences,
	reviewBody,
	root,
	sidebarSeparator,
});

const visibility = createVisibility(app, snapshot.isGitRepository, (open) => {
	reviewLayout.setOpen(open);
	if (open) {
		const nextSelection = selectionForReviewOpen(
			selection,
			preferredWorkingChanges(),
		);
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
});
window.piUi.workspaceReview = visibility;

const tree = new FileTree({
	...workspaceReviewTreeOptions,
	gitStatus: snapshot.changes,
	paths: snapshot.changes.map(({ path }) => path),
	onSelectionChange(paths) {
		const path = paths.length === 1 ? paths[0] : undefined;
		if (path) selectWorking(path, true);
	},
});
tree.hydrate({ fileTreeContainer: treeHost });

history.addEventListener("scroll", maybeLoadOlderHistory, { passive: true });
allButton.addEventListener("click", () => setMode("all"));
selectedButton.addEventListener("click", () => setMode("selected"));
splitButton.addEventListener("click", () => setLayout("split"));
stackedButton.addEventListener("click", () => setLayout("unified"));
wrapButton.addEventListener("click", () => {
	wrap = !wrap;
	wrapButton.setAttribute("aria-pressed", String(wrap));
	writePreferences();
	viewer?.setOptions(viewerOptions());
});
let observedDiffLayout = effectiveLayout();
const resize = new ResizeObserver(() => {
	const nextLayout = effectiveLayout();
	syncLayoutButtons(nextLayout);
	if (nextLayout === observedDiffLayout) return;
	observedDiffLayout = nextLayout;
	viewer?.setOptions(viewerOptions());
});
resize.observe(diffRoot);

const theme = new MutationObserver(() => viewer?.setOptions(viewerOptions()));
theme.observe(document.documentElement, {
	attributeFilter: ["class"],
	attributes: true,
});

let workspaceLabel = currentWorkspaceLabel();
const workspace = new MutationObserver(() => {
	const nextLabel = currentWorkspaceLabel();
	if (nextLabel === workspaceLabel) return;
	workspaceLabel = nextLabel;
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
});
workspace.observe(app, {
	attributeFilter: ["aria-label"],
	attributes: true,
	childList: true,
	subtree: true,
});
const reviewData = new MutationObserver(() => {
	const element = document.getElementById("workspace-review-data");
	if (!element) return;
	try {
		const value = JSON.parse(element.textContent ?? "");
		if (isRecord(value) && isWorkspaceReviewSnapshot(value.snapshot)) {
			applySnapshot(value.snapshot);
		}
	} catch {
		// A later stream morph can replace an incomplete payload.
	}
});
reviewData.observe(app, { childList: true, subtree: true });

syncModeButtons();
syncLayoutButtons();
wrapButton.setAttribute("aria-pressed", String(wrap));
renderHistory();
syncChangesSection();

window.addEventListener(
	"pagehide",
	() => {
		reviewData.disconnect();
		workspace.disconnect();
		resize.disconnect();
		theme.disconnect();
		reviewLayout.cleanUp();
		tree.cleanUp();
		viewer?.cleanUp();
		terminateWorkerPoolSingleton();
	},
	{ once: true },
);

function currentWorkspaceLabel(): string {
	return document.getElementById("workspace-picker")?.getAttribute("aria-label") ?? "";
}

function applySnapshot(next: WorkspaceReviewSnapshot): void {
	if (next.revision === snapshot.revision) return;
	const wasUnloaded = snapshot.revision === "git-unloaded" || !initializedSelection;
	const historyState = reconcileFirstHistoryPage(
		historyCommits,
		historyHasMore,
		next.commits,
	);
	snapshot = next;
	historyCommits = historyState.commits;
	historyHasMore = historyState.hasMore;
	if (historyState.reset) {
		historyGeneration++;
		historyLoading = false;
	}
	visibility.setAvailable(snapshot.isGitRepository);
	const nextWorkingItems = createItems(snapshot.changes, snapshot.patch, "working");
	comments.reconcileItems(nextWorkingItems);
	workingItems = withWorkingAnnotations(nextWorkingItems);
	tree.resetPaths(snapshot.changes.map(({ path }) => path));
	tree.setGitStatus(snapshot.changes);
	branch.textContent = snapshot.branch ?? "";
	branch.style.display = snapshot.branch ? "inline" : "none";
	count.textContent = String(snapshot.changes.length);
	additions.textContent = `+${sum("additions")}`;
	deletions.textContent = `-${sum("deletions")}`;
	syncChangesSection();

	selection = reconcileSelection(
		selection,
		wasUnloaded,
		preferredWorkingChanges(),
		snapshot.commits,
	);
	if (wasUnloaded) initializedSelection = true;

	renderHistory();
	if (visibility.isOpen()) requestAnimationFrame(maybeLoadOlderHistory);
	if (selection.kind === "commit") {
		void activateCommit(selection.hash, selection.path);
	} else activateWorking(selection.path);
}

function syncChangesSection(): void {
	const hasChanges = snapshot.changes.length > 0;
	reviewLayout.sync();
	treeHost.style.display = hasChanges ? "block" : "none";
	treeEmpty.style.display = hasChanges ? "none" : "block";
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
	viewer?.setOptions(viewerOptions());
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
		viewer = new CodeView(viewerOptions(), createWorkerPool());
		viewer.setup(diffRoot);
	} else {
		viewer.setOptions(viewerOptions());
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
			// Pierre 1.3.5 incorrectly invents cache identity from filenames. An
			// explicit content revision avoids stale highlights without remounting
			// every unchanged file whenever the working tree changes.
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

function viewerOptions(): CodeViewOptions<ReviewCommentMetadata> {
	const commentsEnabled = selection.kind === "working" && comments.canAdd();
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
			paddingTop: workspaceStructuralGap,
		},
		lineHoverHighlight: "both",
		overflow: wrap ? "wrap" : "scroll",
		stickyHeaders: true,
		theme: getPierreThemes(),
		themeType: document.documentElement.classList.contains("dark") ? "dark" : "light",
		unsafeCSS: `
			:host {
				--diffs-bg: var(--pi-code-surface);
				--diffs-dark-bg: var(--pi-code-surface);
				--diffs-font-family: var(--font-mono);
				--diffs-gap-block: 0px;
				--diffs-gap-style: 0 solid transparent;
				--diffs-header-font-family: var(--font-sans);
				--diffs-light-bg: var(--pi-code-surface);
				--diffs-scrollbar-gutter-override: 0px;
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
				padding-bottom: 0 !important;
			}

			[data-annotation-content] {
				min-width: 0;
			}

			[data-gutter-utility-slot] {
				right: auto;
				left: 4px;
				justify-content: flex-start;
			}

			[data-utility-button] {
				margin-right: 0;
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
		},
		poolOptions: {
			poolSize: 1,
			totalASTLRUCacheSize: 100,
			workerFactory: () =>
				new Worker(new URL("./pierre-worker.js", import.meta.url), {
					type: "module",
				}),
		},
	});
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
	applyOpen(app.classList.contains("pi-review-open"));
	return {
		applyOpen,
		isOpen: () => open,
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

function sum(key: "additions" | "deletions"): number {
	return snapshot.changes.reduce((total, change) => total + change[key], 0);
}

function emptyMessage(): string {
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
		wrap,
		...reviewLayout.values(),
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
