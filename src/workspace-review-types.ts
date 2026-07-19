import { isRecord } from "./utils/type-guards.ts";

export const workspaceReviewHistoryPageSize = 50;

export type WorkspaceFileStatus =
	| "added"
	| "deleted"
	| "modified"
	| "renamed"
	| "untracked";

export type WorkspaceFileChange = Readonly<{
	additions: number;
	deletions: number;
	path: string;
	status: WorkspaceFileStatus;
}>;

export type WorkspaceCommit = Readonly<{
	author: string;
	authoredAt: string;
	hash: string;
	pushed: boolean | null;
	shortHash: string;
	subject: string;
}>;

export type WorkspaceCommitDetail = Readonly<{
	changes: readonly WorkspaceFileChange[];
	commit: WorkspaceCommit;
	patch: string;
}>;

export type WorkspaceReviewPreferences = Readonly<{
	layout?: "split" | "unified";
	mode?: "all" | "selected";
	wrap?: boolean;
}>;

export function normalizeWorkspaceReviewPreferences(
	value: unknown,
): WorkspaceReviewPreferences {
	if (!isRecord(value)) return {};
	return {
		layout:
			value.layout === "split" || value.layout === "unified"
				? value.layout
				: undefined,
		mode: value.mode === "all" || value.mode === "selected" ? value.mode : undefined,
		wrap: typeof value.wrap === "boolean" ? value.wrap : undefined,
	};
}

export type WorkspaceReviewSnapshot = Readonly<{
	branch: string | null;
	changes: readonly WorkspaceFileChange[];
	commits: readonly WorkspaceCommit[];
	isGitRepository: boolean;
	patch: string;
	revision: string;
}>;
