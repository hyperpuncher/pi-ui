import Type from "typebox";
import { Compile } from "typebox/compile";

import { isBoolean, isNumber, isRecord, type JsonRecord } from "./utils/type-guards.ts";

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
	tab?: "files" | "git";
	wrap?: boolean;
}>;

export function normalizeWorkspaceReviewPreferences<Value>(
	value: Value,
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
		tab: value.tab === "files" || value.tab === "git" ? value.tab : undefined,
		wrap: isBoolean(value.wrap) ? value.wrap : undefined,
	};
}

function normalizedNumber(
	value: JsonRecord[string],
	minimum: number,
	maximum: number,
): number | undefined {
	return isNumber(value) && Number.isFinite(value)
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

export const emptyWorkspaceReviewSnapshot: WorkspaceReviewSnapshot = {
	branch: null,
	changes: [],
	commits: [],
	isGitRepository: false,
	patch: "",
	revision: "non-git",
};

export const unloadedWorkspaceReviewSnapshot: WorkspaceReviewSnapshot = {
	...emptyWorkspaceReviewSnapshot,
	revision: "git-unloaded",
};

const workspaceFileChangeSchema = Type.Object({
	additions: Type.Number(),
	deletions: Type.Number(),
	path: Type.String(),
	status: Type.Union([
		Type.Literal("added"),
		Type.Literal("deleted"),
		Type.Literal("modified"),
		Type.Literal("renamed"),
		Type.Literal("untracked"),
	]),
});

const workspaceCommitSchema = Type.Object({
	author: Type.String(),
	authoredAt: Type.String(),
	hash: Type.String(),
	pushed: Type.Union([Type.Boolean(), Type.Null()]),
	shortHash: Type.String(),
	subject: Type.String(),
});

const workspaceCommitDetailSchema = Type.Object({
	changes: Type.Array(workspaceFileChangeSchema),
	commit: workspaceCommitSchema,
	patch: Type.String(),
});

const workspaceReviewSnapshotSchema = Type.Object({
	branch: Type.Union([Type.String(), Type.Null()]),
	changes: Type.Array(workspaceFileChangeSchema),
	commits: Type.Array(workspaceCommitSchema),
	isGitRepository: Type.Boolean(),
	patch: Type.String(),
	revision: Type.String(),
});

const workspaceCommitDetailValidator = Compile(workspaceCommitDetailSchema);
const workspaceCommitHistoryValidator = Compile(Type.Array(workspaceCommitSchema));
const workspaceReviewSnapshotValidator = Compile(workspaceReviewSnapshotSchema);

export function isWorkspaceCommitDetail<Value>(
	value: Value,
): value is Value & WorkspaceCommitDetail {
	return workspaceCommitDetailValidator.Check(value);
}

export function isWorkspaceCommitHistory<Value>(
	value: Value,
): value is Value & WorkspaceCommit[] {
	return workspaceCommitHistoryValidator.Check(value);
}

export function isWorkspaceReviewSnapshot<Value>(
	value: Value,
): value is Value & WorkspaceReviewSnapshot {
	return workspaceReviewSnapshotValidator.Check(value);
}
