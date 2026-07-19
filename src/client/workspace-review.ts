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
	normalizeWorkspaceReviewPreferences,
	type WorkspaceCommit,
	type WorkspaceCommitDetail,
	type WorkspaceFileChange,
	workspaceReviewHistoryPageSize,
	type WorkspaceReviewPreferences,
	type WorkspaceReviewSnapshot,
} from "../workspace-review-types.ts";

type ReviewMode = NonNullable<WorkspaceReviewPreferences["mode"]>;
type ReviewItem = CodeViewItem<undefined> & { type: "diff" };
type DiffLayout = NonNullable<WorkspaceReviewPreferences["layout"]>;
type UpdateMode = "availability" | "live" | "snapshot";
type Selection =
	| { kind: "working"; path?: string }
	| { hash: string; kind: "commit"; path?: string };
type CommitView = { detail: WorkspaceCommitDetail; items: ReviewItem[] };

const endpoint = document.body.dataset.workspaceReviewEndpoint ?? "";
const preferencesEndpoint = `${endpoint}/preferences`;
const preferences = await readPreferences();

const root = requiredElement("workspace-review");
const app = requiredElement("app");
const treeHost = requiredElement("review-file-tree");
const treeEmpty = requiredElement("review-tree-empty");
const changesSection = requiredElement("review-changes-section");
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
let preferenceWrites = Promise.resolve();

const visibility = createVisibility(root, snapshot.isGitRepository, (open) => {
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

const commitEndpoint = `${endpoint}/commit`;
const historyEndpoint = `${endpoint}/history`;
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
	const wasUnloaded = snapshot.revision === "git-unloaded" || !initializedSelection;
	const sameHead = historyCommits[0]?.hash === next.commits[0]?.hash;
	snapshot = next;
	if (sameHead) {
		const firstPageHashes = new Set(next.commits.map(({ hash }) => hash));
		historyCommits = [
			...next.commits,
			...historyCommits
				.slice(workspaceReviewHistoryPageSize)
				.filter(({ hash }) => !firstPageHashes.has(hash)),
		];
	} else {
		historyGeneration++;
		historyCommits = [...next.commits];
		historyHasMore = next.commits.length === workspaceReviewHistoryPageSize;
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

	if (wasUnloaded) {
		initializedSelection = true;
		selection =
			snapshot.changes.length > 0
				? { kind: "working", path: snapshot.changes[0]?.path }
				: snapshot.commits[0]
					? { hash: snapshot.commits[0].hash, kind: "commit" }
					: { kind: "working" };
	} else if (selection.kind === "working") {
		selection.path = snapshot.changes.some(({ path }) => path === selection.path)
			? selection.path
			: snapshot.changes[0]?.path;
	}

	renderHistory();
	if (visibility.isOpen()) requestAnimationFrame(maybeLoadOlderHistory);
	if (selection.kind === "commit") void activateCommit(selection.hash, selection.path);
	else activateWorking(selection.path);
}

function syncChangesSection(): void {
	const hasChanges = snapshot.changes.length > 0;
	changesSection.classList.toggle("h-[45%]", hasChanges);
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
	renderDetailHeader(view.detail.commit);
	renderHistory();
	publish();
}

function loadCommit(hash: string): Promise<CommitView | undefined> {
	const existing = commitRequests.get(hash);
	if (existing) return existing;
	const requestedWorkspaceVersion = workspaceVersion;
	const request = fetch(`${commitEndpoint}?hash=${encodeURIComponent(hash)}`, {
		headers: { accept: "application/json" },
	})
		.then(async (response) => {
			if (!response.ok) return undefined;
			const detail = (await response.json()) as WorkspaceCommitDetail;
			const view = {
				detail,
				items: createItems(detail.changes, detail.patch, detail.commit.hash),
			};
			if (requestedWorkspaceVersion !== workspaceVersion) return undefined;
			commitCache.set(hash, view);
			return view;
		})
		.catch(() => undefined)
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
	const scrollTop = history.scrollTop;
	history.replaceChildren();
	if (historyCommits.length === 0) {
		const message = document.createElement("p");
		message.className = "text-muted-foreground px-2 py-1 text-xs";
		message.textContent =
			snapshot.revision === "git-unloaded" ? "Loading history…" : "No commits yet";
		history.append(message);
		return;
	}
	let previousPushState: boolean | null | undefined;
	for (const commit of historyCommits) {
		if (commit.pushed !== previousPushState) {
			history.append(renderPushGroup(commit.pushed));
			previousPushState = commit.pushed;
		}
		const selected = selection.kind === "commit" && selection.hash === commit.hash;
		const row = document.createElement("div");
		const button = document.createElement("button");
		button.type = "button";
		button.className =
			"hover:bg-muted/60 aria-pressed:bg-muted flex w-full min-w-0 flex-col rounded-md px-2 py-1.5 text-left";
		button.setAttribute("aria-pressed", String(selected));
		button.title = commit.subject;
		button.addEventListener("click", () => void activateCommit(commit.hash));

		const subject = document.createElement("span");
		subject.className = "w-full truncate text-xs";
		subject.textContent = commit.subject || "Untitled commit";
		const metadata = document.createElement("span");
		metadata.className =
			"text-muted-foreground flex w-full min-w-0 items-center gap-1.5 font-mono text-[10px]";
		const shortHash = document.createElement("span");
		shortHash.className = "shrink-0";
		shortHash.textContent = commit.shortHash;
		const author = document.createElement("span");
		author.className = "truncate";
		author.textContent = commit.author;
		const date = document.createElement("time");
		date.className = "ml-auto shrink-0";
		date.dateTime = commit.authoredAt;
		date.textContent = formatCommitDate(commit.authoredAt);
		metadata.append(shortHash, author, date);
		button.append(subject, metadata);
		row.append(button);

		if (selected) {
			const view = commitCache.get(commit.hash);
			if (view) row.append(renderCommitFiles(commit.hash, view.detail.changes));
		}
		history.append(row);
	}
	if (historyLoading) {
		const loading = document.createElement("p");
		loading.className = "text-muted-foreground px-2 py-2 text-center text-[10px]";
		loading.textContent = "Loading older commits…";
		history.append(loading);
	}
	history.scrollTop = scrollTop;
}

function renderPushGroup(pushed: boolean | null): HTMLElement {
	const group = document.createElement("div");
	group.className =
		"text-muted-foreground flex items-center gap-2 px-2 py-1 text-[10px] font-medium";
	const label = document.createElement("span");
	label.textContent =
		pushed === null ? "No upstream" : pushed ? "Pushed" : "Not pushed";
	const line = document.createElement("span");
	line.className = "border-border flex-1 border-t";
	group.append(label, line);
	return group;
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
	try {
		const response = await fetch(
			`${historyEndpoint}?offset=${historyCommits.length}`,
			{ headers: { accept: "application/json" } },
		);
		if (!response.ok) throw new Error("Unable to load Git history");
		const commits = (await response.json()) as WorkspaceCommit[];
		if (generation !== historyGeneration) return;
		const known = new Set(historyCommits.map(({ hash }) => hash));
		const additions = commits.filter(({ hash }) => !known.has(hash));
		historyCommits.push(...additions);
		historyHasMore =
			commits.length === workspaceReviewHistoryPageSize && additions.length > 0;
	} catch {
		if (generation === historyGeneration) historyHasMore = false;
	} finally {
		if (generation === historyGeneration) {
			historyLoading = false;
			renderHistory();
			requestAnimationFrame(maybeLoadOlderHistory);
		}
	}
}

function renderCommitFiles(
	hash: string,
	changes: readonly WorkspaceFileChange[],
): HTMLElement {
	const files = document.createElement("div");
	files.className = "border-border ml-3 border-l py-0.5 pl-1";
	for (const change of changes) {
		const button = document.createElement("button");
		button.type = "button";
		button.className =
			"hover:bg-muted/60 aria-pressed:bg-muted flex w-full min-w-0 items-center gap-1.5 rounded px-2 py-1 text-left text-[11px]";
		button.setAttribute("aria-pressed", String(selection.path === change.path));
		button.title = change.path;
		button.addEventListener("click", () => selectCommitPath(hash, change.path));
		const status = document.createElement("span");
		status.className = "text-muted-foreground w-3 shrink-0 font-mono";
		status.textContent = statusLetter(change.status);
		const path = document.createElement("span");
		path.className = "truncate";
		path.textContent = change.path;
		button.append(status, path);
		files.append(button);
	}
	return files;
}

function renderDetailHeader(commit: WorkspaceCommit): void {
	detailHeader.replaceChildren();
	detailHeader.classList.remove("hidden");
	const subject = document.createElement("div");
	subject.className = "truncate text-xs font-medium";
	subject.textContent = commit.subject || "Untitled commit";
	const metadata = document.createElement("div");
	metadata.className =
		"text-muted-foreground mt-0.5 flex min-w-0 items-center gap-2 font-mono text-[10px]";
	const hash = document.createElement("span");
	hash.textContent = commit.shortHash;
	const author = document.createElement("span");
	author.className = "truncate";
	author.textContent = commit.author;
	const date = document.createElement("time");
	date.className = "ml-auto shrink-0";
	date.dateTime = commit.authoredAt;
	date.textContent = new Intl.DateTimeFormat(undefined, {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(new Date(commit.authoredAt));
	metadata.append(hash, author, date);
	detailHeader.append(subject, metadata);
}

function hideDetailHeader(): void {
	detailHeader.classList.add("hidden");
	detailHeader.replaceChildren();
}

function formatCommitDate(value: string): string {
	const date = new Date(value);
	const elapsedDays = Math.floor((Date.now() - date.getTime()) / 86_400_000);
	if (elapsedDays <= 0) return "today";
	if (elapsedDays === 1) return "1d";
	if (elapsedDays < 30) return `${elapsedDays}d`;
	return new Intl.DateTimeFormat(undefined, {
		month: "short",
		year: "2-digit",
	}).format(date);
}

function statusLetter(status: WorkspaceFileChange["status"]): string {
	if (status === "added") return "A";
	if (status === "deleted") return "D";
	if (status === "renamed") return "R";
	if (status === "untracked") return "U";
	return "M";
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

function syncModeButtons(): void {
	allButton.setAttribute("aria-pressed", String(mode === "all"));
	selectedButton.setAttribute("aria-pressed", String(mode === "selected"));
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
	if (!snapshot.isGitRepository) return "Open a Git repository";
	if (selection.kind === "commit") return "This commit has no file changes";
	if (snapshot.changes.length === 0) return "Working tree clean";
	return "No changes to display";
}

function showEmpty(message?: string): void {
	empty.style.display = message ? "grid" : "none";
	if (message) empty.textContent = message;
}

async function readPreferences(): Promise<WorkspaceReviewPreferences> {
	try {
		const response = await fetch(preferencesEndpoint, {
			cache: "no-store",
			headers: { accept: "application/json" },
			signal: AbortSignal.timeout(2_000),
		});
		if (!response.ok) return {};
		return normalizeWorkspaceReviewPreferences(await response.json());
	} catch {
		return {};
	}
}

function writePreferences(): void {
	const body = JSON.stringify({ layout, mode, wrap });
	preferenceWrites = preferenceWrites
		.then(async () => {
			const response = await fetch(preferencesEndpoint, {
				body,
				headers: { "content-type": "application/json" },
				keepalive: true,
				method: "POST",
			});
			if (!response.ok) throw new Error("Unable to save Git view preferences");
		})
		.catch(() => {});
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
