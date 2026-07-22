import {
	type WorkspaceCommit,
	type WorkspaceCommitDetail,
	type WorkspaceFileChange,
} from "../workspace-review-types.ts";
import type { Selection } from "./workspace-review-state.ts";

type HistoryRenderOptions = Readonly<{
	commits: readonly WorkspaceCommit[];
	getCommitDetail: (hash: string) => WorkspaceCommitDetail | undefined;
	history: HTMLElement;
	loading: boolean;
	onSelectCommit: (hash: string) => void;
	onSelectCommitPath: (hash: string, path: string) => void;
	revision: string;
	selection: Selection;
}>;

export function renderWorkspaceReviewHistory({
	commits,
	getCommitDetail,
	history,
	loading,
	onSelectCommit,
	onSelectCommitPath,
	revision,
	selection,
}: HistoryRenderOptions): void {
	const scrollTop = history.scrollTop;
	history.replaceChildren();
	if (commits.length === 0) {
		const message = document.createElement("p");
		message.className = "text-muted-foreground px-2 py-1 text-xs";
		message.textContent =
			revision === "git-unloaded" ? "Loading history…" : "No commits yet";
		history.append(message);
		return;
	}
	let previousPushState: boolean | null | undefined;
	for (const commit of commits) {
		if (commit.pushed !== previousPushState) {
			history.append(renderPushGroup(commit.pushed));
			previousPushState = commit.pushed;
		}
		const selected = selection.kind === "commit" && selection.hash === commit.hash;
		const row = document.createElement("div");
		const button = document.createElement("button");
		button.type = "button";
		button.className =
			"pi-selected-surface hover:bg-muted/60 flex w-full min-w-0 flex-col rounded-md px-2 py-1.5 text-left";
		button.setAttribute("aria-pressed", String(selected));
		button.title = commit.subject;
		button.addEventListener("click", () => onSelectCommit(commit.hash));

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
			const detail = getCommitDetail(commit.hash);
			if (detail) {
				row.append(
					renderCommitFiles(
						commit.hash,
						detail.changes,
						selection.path,
						onSelectCommitPath,
					),
				);
			}
		}
		history.append(row);
	}
	if (loading) {
		const message = document.createElement("p");
		message.className = "text-muted-foreground px-2 py-2 text-center text-[10px]";
		message.textContent = "Loading older commits…";
		history.append(message);
	}
	history.scrollTop = scrollTop;
}

export function showWorkspaceReviewDetailHeader(
	detailHeader: HTMLElement,
	detail: WorkspaceCommitDetail,
): void {
	detailHeader.replaceChildren();
	detailHeader.classList.remove("hidden");
	const heading = document.createElement("div");
	heading.className = "flex min-w-0 items-center gap-2";
	const subject = document.createElement("div");
	subject.className = "min-w-0 flex-1 truncate text-xs font-medium";
	subject.textContent = detail.commit.subject || "Untitled commit";
	const totals = document.createElement("span");
	totals.className = "flex shrink-0 gap-1 font-mono text-[10px] tabular-nums";
	const additions = document.createElement("span");
	additions.className = "text-(--pi-success)";
	additions.textContent = `+${sumChanges(detail.changes, "additions")}`;
	const deletions = document.createElement("span");
	deletions.className = "text-destructive";
	deletions.textContent = `-${sumChanges(detail.changes, "deletions")}`;
	totals.append(additions, deletions);
	heading.append(subject, totals);
	const metadata = document.createElement("div");
	metadata.className =
		"text-muted-foreground mt-0.5 flex min-w-0 items-center gap-2 font-mono text-[10px]";
	const hash = document.createElement("span");
	hash.textContent = detail.commit.shortHash;
	const author = document.createElement("span");
	author.className = "truncate";
	author.textContent = detail.commit.author;
	const date = document.createElement("time");
	date.className = "ml-auto shrink-0";
	date.dateTime = detail.commit.authoredAt;
	date.textContent = formatCommitDetailDate(detail.commit.authoredAt);
	metadata.append(hash, author, date);
	detailHeader.append(heading, metadata);
}

export function hideWorkspaceReviewDetailHeader(detailHeader: HTMLElement): void {
	detailHeader.classList.add("hidden");
	detailHeader.replaceChildren();
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

function renderCommitFiles(
	hash: string,
	changes: readonly WorkspaceFileChange[],
	selectedPath: string | undefined,
	onSelect: (hash: string, path: string) => void,
): HTMLElement {
	const files = document.createElement("div");
	files.className = "border-border ml-3 border-l py-0.5 pl-1";
	for (const change of changes) {
		const button = document.createElement("button");
		button.type = "button";
		button.className =
			"pi-selected-surface hover:bg-muted/60 flex w-full min-w-0 items-center gap-1.5 rounded px-2 py-1 text-left text-[11px]";
		button.setAttribute("aria-pressed", String(selectedPath === change.path));
		button.title = change.path;
		button.addEventListener("click", () => onSelect(hash, change.path));
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

export function formatCommitDetailDate(
	value: string,
	locale = configuredTimeLocale(),
): string {
	return new Intl.DateTimeFormat(locale, {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(new Date(value));
}

export function formatCommitDate(
	value: string,
	now = new Date(),
	locale = configuredTimeLocale(),
): string {
	const date = new Date(value);
	const calendarDays = calendarDayNumber(now) - calendarDayNumber(date);
	if (calendarDays <= 0) return "today";
	if (calendarDays === 1) return "1d";
	if (calendarDays < 30) return `${calendarDays}d`;
	return new Intl.DateTimeFormat(locale, {
		month: "short",
		year: "2-digit",
	}).format(date);
}

function configuredTimeLocale(): string | undefined {
	return typeof document === "undefined"
		? undefined
		: document.body.dataset.timeLocale || undefined;
}

function calendarDayNumber(date: Date): number {
	return Date.UTC(date.getFullYear(), date.getMonth(), date.getDate()) / 86_400_000;
}

function sumChanges(
	changes: readonly WorkspaceFileChange[],
	key: "additions" | "deletions",
): number {
	return changes.reduce((total, change) => total + change[key], 0);
}

function statusLetter(status: WorkspaceFileChange["status"]): string {
	if (status === "added") return "A";
	if (status === "deleted") return "D";
	if (status === "renamed") return "R";
	if (status === "untracked") return "U";
	return "M";
}
