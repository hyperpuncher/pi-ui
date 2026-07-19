import { isRecord } from "./utils/type-guards.ts";

export const workspaceReviewHistoryPageSize = 50;
export const gitPaneRatioDefault = 0.5;
export const gitPaneRatioMin = 0.35;
export const gitPaneRatioMax = 0.65;
export const reviewSidebarWidthDefault = 272;
export const reviewSidebarWidthMin = 224;
export const reviewSidebarWidthMax = 480;
export const changesRatioDefault = 0.5;
export const changesRatioMin = 0.3;
export const changesRatioMax = 0.7;

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
	changesRatio?: number;
	gitPaneRatio?: number;
	layout?: "split" | "unified";
	mode?: "all" | "selected";
	reviewSidebarWidth?: number;
	wrap?: boolean;
}>;

export function normalizeWorkspaceReviewPreferences(
	value: unknown,
): WorkspaceReviewPreferences {
	if (!isRecord(value)) return {};
	return {
		changesRatio: normalizedNumber(
			value.changesRatio,
			changesRatioMin,
			changesRatioMax,
		),
		gitPaneRatio: normalizedNumber(
			value.gitPaneRatio,
			gitPaneRatioMin,
			gitPaneRatioMax,
		),
		layout:
			value.layout === "split" || value.layout === "unified"
				? value.layout
				: undefined,
		mode: value.mode === "all" || value.mode === "selected" ? value.mode : undefined,
		reviewSidebarWidth: normalizedNumber(
			value.reviewSidebarWidth,
			reviewSidebarWidthMin,
			reviewSidebarWidthMax,
		),
		wrap: typeof value.wrap === "boolean" ? value.wrap : undefined,
	};
}

function normalizedNumber(
	value: unknown,
	minimum: number,
	maximum: number,
): number | undefined {
	return typeof value === "number" && Number.isFinite(value)
		? Math.min(Math.max(value, minimum), maximum)
		: undefined;
}

export type WorkspaceReviewSnapshot = Readonly<{
	branch: string | null;
	changes: readonly WorkspaceFileChange[];
	commits: readonly WorkspaceCommit[];
	isGitRepository: boolean;
	patch: string;
	revision: string;
}>;
