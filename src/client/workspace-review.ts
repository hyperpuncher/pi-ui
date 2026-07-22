import {
	CodeView,
	DEFAULT_THEMES,
	parsePatchFiles,
	type CodeViewItem,
	type CodeViewOptions,
	type FileDiffMetadata,
} from "@pierre/diffs";
import {
	getOrCreateWorkerPoolSingleton,
	terminateWorkerPoolSingleton,
} from "@pierre/diffs/worker";
import { FileTree } from "@pierre/trees";

import { workspaceReviewTreeOptions } from "../workspace-review-tree.ts";
import {
	type WorkspaceCommitDetail,
	type WorkspaceFileChange,
	workspaceReviewHistoryPageSize,
	type WorkspaceReviewPreferences,
	type WorkspaceReviewSnapshot,
} from "../workspace-review-types.ts";
import {
	createWorkspaceReviewApi,
	type WorkspaceReviewUpdateMode,
} from "./workspace-review-api.ts";
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
	type Selection,
} from "./workspace-review-state.ts";

type ReviewMode = NonNullable<WorkspaceReviewPreferences["mode"]>;
type ReviewItem = CodeViewItem<undefined> & { type: "diff" };
type DiffLayout = NonNullable<WorkspaceReviewPreferences["layout"]>;
type CommitView = { detail: WorkspaceCommitDetail; items: ReviewItem[] };

const diffListEndPadding = 10;
const endpoint = document.body.dataset.workspaceReviewEndpoint ?? "";
const api = createWorkspaceReviewApi(endpoint);
const preferences = await api.readPreferences();

const root = requiredElement("workspace-review");
const app = requiredElement("app");
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
const workingTreeButton = requiredButton("review-working-tree");
const additions = requiredElement("review-total-additions");
const deletions = requiredElement("review-total-deletions");
const allButton = requiredButton("review-mode-all");
const selectedButton = requiredButton("review-mode-selected");
const splitButton = requiredButton("review-layout-split");
const stackedButton = requiredButton("review-layout-stacked");
const wrapButton = requiredButton("review-wrap");
const data = requiredElement("workspace-review-data");

let snapshot = JSON.parse(data.textContent ?? "") as WorkspaceReviewSnapshot;
let historyCommits = [...snapshot.commits];
let historyHasMore = snapshot.commits.length === workspaceReviewHistoryPageSize;
let historyLoading = false;
let historyGeneration = 0;
let mode: ReviewMode = preferences.mode ?? "all";
let selection: Selection = { kind: "working", path: snapshot.changes[0]?.path };
let layout: DiffLayout | undefined = preferences.layout;
let wrap = preferences.wrap ?? true;
let version = 0;
let workingItems = createItems(snapshot.changes, snapshot.patch, "working");
let items = workingItems;
let itemsByPath = itemMap(items);
let viewer: CodeView | undefined;
let initializedSelection = snapshot.revision !== "git-unloaded";
const commitCache = new Map<string, CommitView>();
const commitRequests = new Map<string, Promise<CommitView | undefined>>();
let workspaceVersion = 0;

const reviewLayout = bindWorkspaceReviewLayout({
	app,
	changesSection,
	changesSeparator,
	chat,
	gitSeparator,
	hasChanges: () => snapshot.changes.length > 0,
	onCommit: (values) => api.writePreferences({ layout, mode, wrap, ...values }),
	preferences,
	reviewBody,
	root,
	sidebarSeparator,
});

const visibility = createVisibility(root, snapshot.isGitRepository, (open) => {
	reviewLayout.setOpen(open);
	if (open) {
		cancelSnapshotPrefetch();
		connectUpdates("live");
		if (snapshot.revision === "git-unloaded") showEmpty("Loading Git data…");
		else
			requestAnimationFrame(() => {
				publish();
				maybeLoadOlderHistory();
			});
	} else {
		disconnectUpdates();
		scheduleSnapshotPrefetch();
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

workingTreeButton.addEventListener("click", () =>
	selectWorking(
		selection.kind === "working" ? selection.path : snapshot.changes[0]?.path,
	),
);
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

const resize = new ResizeObserver(() => {
	syncLayoutButtons();
	viewer?.setOptions(viewerOptions());
});
resize.observe(diffRoot);

const theme = new MutationObserver(() => viewer?.setOptions(viewerOptions()));
theme.observe(document.documentElement, { attributeFilter: ["class"], attributes: true });

let prefetchIdle: number | undefined;
let prefetchTimer: ReturnType<typeof setTimeout> | undefined;
let updates: EventSource | undefined;
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
	initializedSelection = false;
	selection = { kind: "working" };
	connectUpdates(visibility.isOpen() ? "live" : "availability");
});
workspace.observe(app, {
	attributeFilter: ["aria-label"],
	attributes: true,
	childList: true,
	subtree: true,
});

syncModeButtons();
syncLayoutButtons();
wrapButton.setAttribute("aria-pressed", String(wrap));
renderHistory();
syncChangesSection();
scheduleSnapshotPrefetch();

window.addEventListener(
	"pagehide",
	() => {
		cancelSnapshotPrefetch();
		disconnectUpdates();
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

function connectUpdates(mode: WorkspaceReviewUpdateMode): void {
	disconnectUpdates();
	updates = api.subscribe(mode, (next) => {
		applySnapshot(next);
		if (mode !== "live") {
			disconnectUpdates();
			if (mode === "availability") scheduleSnapshotPrefetch();
		}
	});
}

function disconnectUpdates(): void {
	updates?.close();
	updates = undefined;
}

function scheduleSnapshotPrefetch(): void {
	cancelSnapshotPrefetch();
	if (
		visibility.isOpen() ||
		!snapshot.isGitRepository ||
		snapshot.revision !== "git-unloaded"
	)
		return;
	prefetchTimer = setTimeout(() => {
		prefetchTimer = undefined;
		prefetchIdle = requestIdleCallback(
			() => {
				prefetchIdle = undefined;
				if (!visibility.isOpen()) connectUpdates("snapshot");
			},
			{ timeout: 2_000 },
		);
	}, 500);
}

function cancelSnapshotPrefetch(): void {
	if (prefetchTimer !== undefined) clearTimeout(prefetchTimer);
	if (prefetchIdle !== undefined) cancelIdleCallback(prefetchIdle);
	prefetchTimer = undefined;
	prefetchIdle = undefined;
}

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
	workingItems = createItems(snapshot.changes, snapshot.patch, "working");
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
		snapshot.changes,
		snapshot.commits,
	);
	if (wasUnloaded) initializedSelection = true;

	renderHistory();
	if (visibility.isOpen()) requestAnimationFrame(maybeLoadOlderHistory);
	if (selection.kind === "commit") void activateCommit(selection.hash, selection.path);
	else activateWorking(selection.path);
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
	if (mode === "selected" && !selection.path) selection.path = items[0]?.fileDiff.name;
	renderHistory();
	publish();
}

function setLayout(next: DiffLayout): void {
	layout = next;
	syncLayoutButtons();
	writePreferences();
	viewer?.setOptions(viewerOptions());
}

function selectWorking(path?: string, fromTree = false): void {
	selection = { kind: "working", path };
	workingTreeButton.setAttribute("aria-pressed", "true");
	activateWorking(path);
	renderHistory();
	if (path && !fromTree) {
		tree.getItem(path)?.select();
		tree.scrollToPath(path, { focus: false, offset: "nearest" });
	}
	if (path) scrollToPath(path);
}

function activateWorking(path?: string): void {
	selection = { kind: "working", path };
	workingTreeButton.setAttribute("aria-pressed", "true");
	items = workingItems;
	itemsByPath = itemMap(items);
	hideDetailHeader();
	publish();
}

async function activateCommit(hash: string, path?: string): Promise<void> {
	selection = { hash, kind: "commit", path };
	workingTreeButton.setAttribute("aria-pressed", "false");
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
	workingTreeButton.setAttribute("aria-pressed", "false");
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
		viewer = new CodeView(viewerOptions(), createWorkerPool());
		viewer.setup(diffRoot);
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
	version++;
	return changes.map((change) => ({
		fileDiff: parsed.get(change.path) ?? emptyDiff(change),
		id: `diff:${source}:${change.path}`,
		type: "diff",
		version,
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

function viewerOptions(): CodeViewOptions<undefined> {
	return {
		diffIndicators: "none",
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
		theme: DEFAULT_THEMES,
		themeType: document.documentElement.classList.contains("dark") ? "dark" : "light",
		unsafeCSS: `
			:host {
				--diffs-bg: var(--pi-surface-raised);
				--diffs-dark-bg: var(--pi-surface-raised);
				--diffs-font-family: var(--font-mono);
				--diffs-gap-block: 0px;
				--diffs-gap-style: 0 solid transparent;
				--diffs-header-font-family: var(--font-sans);
				--diffs-light-bg: var(--pi-surface-raised);
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
		`,
	};
}

function createWorkerPool() {
	return getOrCreateWorkerPoolSingleton({
		highlighterOptions: {
			langs: ["text"],
			preferredHighlighter: "shiki-js",
			theme: DEFAULT_THEMES,
		},
		poolOptions: {
			poolSize: 1,
			totalASTLRUCacheSize: 100,
			workerFactory: () =>
				new Worker("/build/pierre-worker.js", { type: "module" }),
		},
	});
}

function createVisibility(
	pane: HTMLElement,
	initiallyAvailable: boolean,
	onChange: (open: boolean) => void,
) {
	let available = initiallyAvailable;
	let hideTimer: ReturnType<typeof setTimeout> | undefined;
	let open = false;
	const hide = () => {
		hideTimer = undefined;
		if (!open) pane.style.display = "none";
	};
	const sync = () => {
		const button = document.querySelector<HTMLElement>(
			'[data-pi-ui-action="review"]',
		);
		if (button) {
			button.inert = !available;
			button.style.visibility = available ? "visible" : "hidden";
			button.dataset.variant = open ? "secondary" : "ghost";
			button.setAttribute("aria-pressed", String(open));
		}
		if (hideTimer !== undefined) clearTimeout(hideTimer);
		hideTimer = undefined;
		if (open) {
			pane.style.display = "grid";
			pane.getBoundingClientRect();
		}
		pane.style.transform = open ? "translateX(0)" : "translateX(-100%)";
		pane.style.opacity = open ? "1" : "0";
		if (!open && pane.style.display !== "none") {
			hideTimer = setTimeout(
				hide,
				matchMedia("(prefers-reduced-motion: reduce)").matches ? 0 : 160,
			);
		}
		pane.inert = !open;
		pane.setAttribute("aria-hidden", String(!open));
	};
	const setOpen = (next: boolean) => {
		const wasOpen = open;
		open = available && next;
		sync();
		if (open !== wasOpen) onChange(open);
	};
	pane.addEventListener("transitionend", (event) => {
		if (event.propertyName !== "transform") return;
		if (open) pane.style.removeProperty("transform");
		else hide();
	});
	sync();
	return {
		isOpen: () => open,
		setAvailable(next: boolean) {
			available = next;
			if (!available && open) setOpen(false);
			else sync();
		},
		setOpen,
		toggle: () => setOpen(!open),
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

function syncLayoutButtons(): void {
	const split = effectiveLayout() === "split";
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
	api.writePreferences({ layout, mode, wrap, ...reviewLayout.values() });
}

function requiredElement(id: string): HTMLElement {
	const element = document.getElementById(id);
	if (!(element instanceof HTMLElement)) throw new Error(`Missing #${id}`);
	return element;
}

function requiredButton(id: string): HTMLButtonElement {
	const element = document.getElementById(id);
	if (!(element instanceof HTMLButtonElement)) throw new Error(`Missing #${id}`);
	return element;
}
