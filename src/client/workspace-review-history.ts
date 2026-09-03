import {
	formatAdaptiveDateTime,
	formatExpandedDateTime,
} from "../utils/date-time-format.ts";
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
		message.className = "review-history-message";
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
		button.className = "review-commit";
		button.setAttribute("aria-pressed", String(selected));
		button.title = commit.subject;
		button.addEventListener("click", () => onSelectCommit(commit.hash));

		const subject = document.createElement("span");
		subject.className = "review-commit-subject";
		subject.textContent = commit.subject || "Untitled commit";
		const metadata = document.createElement("span");
		metadata.className = "fine-print review-commit-meta";
		const shortHash = document.createElement("span");
		shortHash.className = "review-commit-hash";
		shortHash.textContent = commit.shortHash;
		const author = document.createElement("span");
		author.className = "review-commit-author";
		author.textContent = commit.author;
		const date = document.createElement("time");
		date.className = "formatted-date";
		date.dateTime = commit.authoredAt;
		date.title = formatCommitDetailDate(commit.authoredAt);
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
		message.className = "fine-print review-history-loading";
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
	detailHeader.hidden = false;
	const heading = document.createElement("div");
	heading.className = "review-detail-heading";
	const subject = document.createElement("div");
	subject.className = "review-detail-subject";
	subject.textContent = detail.commit.subject || "Untitled commit";
	const totals = document.createElement("span");
	totals.className = "review-detail-totals";
	const additions = document.createElement("span");
	additions.className = "review-additions";
	additions.textContent = `+${sumChanges(detail.changes, "additions")}`;
	const deletions = document.createElement("span");
	deletions.className = "review-deletions";
	deletions.textContent = `-${sumChanges(detail.changes, "deletions")}`;
	totals.append(additions, deletions);
	heading.append(subject, totals);
	const metadata = document.createElement("div");
	metadata.className = "fine-print review-detail-meta";
	const hash = document.createElement("span");
	hash.className = "review-detail-hash";
	hash.textContent = detail.commit.shortHash;
	const author = document.createElement("span");
	author.className = "review-detail-author";
	author.textContent = detail.commit.author;
	const date = document.createElement("time");
	date.className = "formatted-date";
	date.dateTime = detail.commit.authoredAt;
	date.title = formatCommitDetailDate(detail.commit.authoredAt);
	date.textContent = date.title;
	metadata.append(hash, author, date);
	detailHeader.append(heading, metadata);
}

export function hideWorkspaceReviewDetailHeader(detailHeader: HTMLElement): void {
	detailHeader.hidden = true;
	detailHeader.replaceChildren();
}

function renderPushGroup(pushed: boolean | null): HTMLElement {
	const group = document.createElement("div");
	group.className = "fine-print review-push-group";
	const label = document.createElement("span");
	label.textContent =
		pushed === null ? "No upstream" : pushed ? "Pushed" : "Not pushed";
	const line = document.createElement("span");
	line.className = "review-push-rule";
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
	files.className = "review-commit-files";
	for (const change of changes) {
		const button = document.createElement("button");
		button.type = "button";
		button.className = "fine-print review-commit-file";
		button.setAttribute("aria-pressed", String(selectedPath === change.path));
		button.title = change.path;
		button.addEventListener("click", () => onSelect(hash, change.path));
		const status = document.createElement("span");
		status.className = "review-commit-file-status";
		status.textContent = statusLetter(change.status);
		const path = document.createElement("span");
		path.className = "review-commit-file-path";
		path.textContent = change.path;
		button.append(status, path);
		files.append(button);
	}
	return files;
}

export function formatCommitDetailDate(value: string, locale?: string): string {
	return formatExpandedDateTime(new Date(value), locale);
}

export function formatCommitDate(
	value: string,
	now = new Date(),
	locale?: string,
): string {
	return formatAdaptiveDateTime(new Date(value), now, locale);
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
