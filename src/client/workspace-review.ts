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

import type {
	WorkspaceFileChange,
	WorkspaceReviewSnapshot,
} from "../workspace-review-types.ts";

type ReviewMode = "all" | "selected";
type ReviewItem = CodeViewItem<undefined> & { type: "diff" };
type DiffLayout = "split" | "unified";
type UpdateMode = "availability" | "live" | "snapshot";

const treeOptions = {
	flattenEmptyDirectories: true,
	id: "review-file-tree",
	initialExpansion: "open" as const,
	initialVisibleRowCount: 20,
	search: false,
	stickyFolders: true,
	unsafeCSS:
		":host { --trees-padding-inline-override: 0px; } [data-item-git-status] > [data-item-section='content'] { color: var(--trees-fg); }",
};

const root = requiredElement("workspace-review");
const app = requiredElement("app");
const treeHost = requiredElement("review-file-tree");
const diffRoot = requiredElement("review-diff-view");
const empty = requiredElement("review-empty");
const count = requiredElement("review-change-count");
const additions = requiredElement("review-total-additions");
const deletions = requiredElement("review-total-deletions");
const allButton = requiredButton("review-mode-all");
const selectedButton = requiredButton("review-mode-selected");
const splitButton = requiredButton("review-layout-split");
const stackedButton = requiredButton("review-layout-stacked");
const wrapButton = requiredButton("review-wrap");
const data = requiredElement("workspace-review-data");

let snapshot = JSON.parse(data.textContent ?? "") as WorkspaceReviewSnapshot;
let mode: ReviewMode = "all";
let selectedPath = snapshot.changes[0]?.path;
let layout: DiffLayout | undefined;
let wrap = true;
let version = 0;
let items: ReviewItem[] = createItems(snapshot);
let itemsByPath = new Map(items.map((item) => [item.fileDiff.name, item]));
let viewer: CodeView | undefined;

const visibility = createVisibility(root, snapshot.isGitRepository, (open) => {
	if (open) {
		cancelSnapshotPrefetch();
		connectUpdates("live");
		if (snapshot.revision === "git-unloaded") {
			showEmpty("Loading changes…");
		} else {
			requestAnimationFrame(publish);
		}
	} else {
		disconnectUpdates();
		scheduleSnapshotPrefetch();
	}
});
window.piUi.workspaceReview = visibility;

const tree = new FileTree({
	...treeOptions,
	gitStatus: snapshot.changes,
	paths: snapshot.changes.map(({ path }) => path),
	onSelectionChange(paths) {
		const path = paths.length === 1 ? paths[0] : undefined;
		if (path) select(path, true);
	},
});
tree.hydrate({ fileTreeContainer: treeHost });

allButton.addEventListener("click", () => setMode("all"));
selectedButton.addEventListener("click", () => setMode("selected"));
splitButton.addEventListener("click", () => setLayout("split"));
stackedButton.addEventListener("click", () => setLayout("unified"));
wrapButton.addEventListener("click", () => {
	wrap = !wrap;
	wrapButton.setAttribute("aria-pressed", String(wrap));
	viewer?.setOptions(viewerOptions());
});

const resize = new ResizeObserver(() => {
	syncLayoutButtons();
	viewer?.setOptions(viewerOptions());
});
resize.observe(diffRoot);

const theme = new MutationObserver(() => viewer?.setOptions(viewerOptions()));
theme.observe(document.documentElement, { attributeFilter: ["class"], attributes: true });

const endpoint = document.body.dataset.workspaceReviewEndpoint ?? "";
let prefetchIdle: number | undefined;
let prefetchTimer: ReturnType<typeof setTimeout> | undefined;
let updates: EventSource | undefined;
let workspaceLabel = currentWorkspaceLabel();
const workspace = new MutationObserver(() => {
	const nextLabel = currentWorkspaceLabel();
	if (nextLabel === workspaceLabel) return;
	workspaceLabel = nextLabel;
	connectUpdates(visibility.isOpen() ? "live" : "availability");
});
workspace.observe(app, {
	attributeFilter: ["aria-label"],
	attributes: true,
	childList: true,
	subtree: true,
});

syncLayoutButtons();
scheduleSnapshotPrefetch();

window.addEventListener(
	"pagehide",
	() => {
		cancelSnapshotPrefetch();
		disconnectUpdates();
		workspace.disconnect();
		resize.disconnect();
		theme.disconnect();
		tree.cleanUp();
		viewer?.cleanUp();
		terminateWorkerPoolSingleton();
	},
	{ once: true },
);

function connectUpdates(mode: UpdateMode): void {
	disconnectUpdates();
	const suffix = mode === "live" ? "" : `?${mode}`;
	const source = new EventSource(`${endpoint}${suffix}`);
	updates = source;
	source.addEventListener("message", (event) => {
		applySnapshot(JSON.parse(event.data) as WorkspaceReviewSnapshot);
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
	snapshot = next;
	visibility.setAvailable(snapshot.isGitRepository);
	if (!snapshot.changes.some(({ path }) => path === selectedPath)) {
		selectedPath = snapshot.changes[0]?.path;
	}
	items = createItems(snapshot);
	itemsByPath = new Map(items.map((item) => [item.fileDiff.name, item]));
	tree.resetPaths(snapshot.changes.map(({ path }) => path));
	tree.setGitStatus(snapshot.changes);
	count.textContent = String(snapshot.changes.length);
	additions.textContent = `+${sum("additions")}`;
	deletions.textContent = `-${sum("deletions")}`;
	if (visibility.isOpen()) publish();
}

function setMode(next: ReviewMode): void {
	mode = next;
	allButton.setAttribute("aria-pressed", String(mode === "all"));
	selectedButton.setAttribute("aria-pressed", String(mode === "selected"));
	publish();
}

function setLayout(next: DiffLayout): void {
	layout = next;
	syncLayoutButtons();
	viewer?.setOptions(viewerOptions());
}

function select(path: string, fromTree = false): void {
	selectedPath = path;
	if (!fromTree) {
		tree.getItem(path)?.select();
		tree.scrollToPath(path, { focus: false, offset: "nearest" });
	}
	if (mode === "selected") return publish();
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

function publish(): void {
	const visible =
		mode === "all"
			? items
			: selectedPath && itemsByPath.has(selectedPath)
				? [itemsByPath.get(selectedPath)!]
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

function createItems(value: WorkspaceReviewSnapshot): ReviewItem[] {
	const parsed = new Map<string, FileDiffMetadata>();
	for (const patch of parsePatchFiles(value.patch)) {
		for (const file of patch.files) parsed.set(file.name, file);
	}
	version++;
	return value.changes.map((change) => ({
		fileDiff: parsed.get(change.path) ?? emptyDiff(change),
		id: `diff:${change.path}`,
		type: "diff",
		version,
	}));
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

function viewerOptions(): CodeViewOptions<undefined> {
	return {
		diffIndicators: "bars",
		diffStyle: layout ?? (diffRoot.clientWidth >= 720 ? "split" : "unified"),
		hunkSeparators: "simple",
		layout: { gap: 2, paddingBottom: 8, paddingTop: 0 },
		lineHoverHighlight: "both",
		overflow: wrap ? "wrap" : "scroll",
		stickyHeaders: true,
		theme: DEFAULT_THEMES,
		themeType: document.documentElement.classList.contains("dark") ? "dark" : "light",
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
	const narrow = matchMedia("(max-width: 80rem)");
	let available = initiallyAvailable;
	let open = false;
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
		pane.style.display = "grid";
		pane.style.transform = open ? "translateX(0)" : "translateX(-100%)";
		pane.style.opacity = open ? "1" : "0";
		pane.inert = !open;
		pane.setAttribute("aria-hidden", String(!open));
		const chat = document.getElementById("chat-pane");
		if (chat) {
			const split = open && !narrow.matches;
			chat.style.width = split ? "50%" : "100%";
			chat.style.marginLeft = split ? "50%" : "0";
		}
	};
	const setOpen = (next: boolean) => {
		const wasOpen = open;
		open = available && next;
		sync();
		if (open !== wasOpen) onChange(open);
	};
	pane.addEventListener("transitionend", (event) => {
		if (event.propertyName === "transform" && open) {
			pane.style.removeProperty("transform");
		}
	});
	narrow.addEventListener("change", sync);
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

function syncLayoutButtons(): void {
	const split =
		(layout ?? (diffRoot.clientWidth >= 720 ? "split" : "unified")) === "split";
	splitButton.setAttribute("aria-pressed", String(split));
	stackedButton.setAttribute("aria-pressed", String(!split));
}

function sum(key: "additions" | "deletions"): number {
	return snapshot.changes.reduce((total, change) => total + change[key], 0);
}

function emptyMessage(): string {
	if (!snapshot.isGitRepository) return "Open a Git repository to review changes";
	if (snapshot.changes.length === 0) return "Working tree clean";
	return "No changes to display";
}

function showEmpty(message?: string): void {
	empty.style.display = message ? "grid" : "none";
	if (message) empty.textContent = message;
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
