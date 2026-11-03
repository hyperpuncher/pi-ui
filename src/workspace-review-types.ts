import {
	arr,
	bool,
	compile,
	nullable,
	num,
	obj,
	oneOf,
	type Static,
	str,
} from "@earendil-works/pi-schema";

import {
	isBoolean,
	isNumber,
	isRecord,
	type JsonRecord,
} from "#src/utils/type-guards.ts";

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

type ReadonlyData<T> = {
	readonly [K in keyof T]: T[K] extends object ? ReadonlyData<T[K]> : T[K];
};

export type WorkspaceFileStatus = WorkspaceFileChange["status"];
export type WorkspaceFileChange = ReadonlyData<Static<typeof workspaceFileChangeSchema>>;
export type WorkspaceCommit = ReadonlyData<Static<typeof workspaceCommitSchema>>;
export type WorkspaceCommitDetail = ReadonlyData<
	Static<typeof workspaceCommitDetailSchema>
>;

export function workspaceChangeStats(changes: readonly WorkspaceFileChange[]) {
	let additions = 0;
	let deletions = 0;
	let tracked = false;
	for (const change of changes) {
		additions += change.additions;
		deletions += change.deletions;
		if (change.status !== "untracked") tracked = true;
	}
	return { additions, deletions, tracked };
}

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
	const preferences: WorkspaceReviewPreferences = {
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
	return Object.fromEntries(
		Object.entries(preferences).filter(([, value]) => value !== undefined),
	);
}

function normalizedNumber(
	value: JsonRecord[string],
	minimum: number,
	maximum: number,
): number | undefined {
	return isNumber(value) ? Math.min(Math.max(value, minimum), maximum) : undefined;
}

export type WorkspaceReviewSnapshot = ReadonlyData<
	Static<typeof workspaceReviewSnapshotSchema>
>;

export const emptyWorkspaceReviewSnapshot: WorkspaceReviewSnapshot = {
	branch: null,
	changes: [],
	commits: [],
	isGitRepository: false,
	changeCount: 0,
	revision: "non-git",
};

export const unloadedWorkspaceReviewSnapshot: WorkspaceReviewSnapshot = {
	...emptyWorkspaceReviewSnapshot,
	revision: "git-unloaded",
};

const workspaceFileChangeSchema = obj(
	{
		additions: num(),
		deletions: num(),
		path: str(),
		status: oneOf(["added", "deleted", "modified", "renamed", "untracked"]),
	},
	{ open: true },
);

const workspaceCommitSchema = obj(
	{
		author: str(),
		authoredAt: str(),
		hash: str(),
		pushed: nullable(bool()),
		shortHash: str(),
		subject: str(),
		tags: arr(str()),
	},
	{ open: true },
);

const workspaceCommitDetailSchema = obj(
	{
		changes: arr(workspaceFileChangeSchema),
		commit: workspaceCommitSchema,
		patch: str(),
	},
	{ open: true },
);

const workspaceReviewSnapshotSchema = obj(
	{
		branch: nullable(str()),
		changes: arr(workspaceFileChangeSchema),
		commits: arr(workspaceCommitSchema),
		isGitRepository: bool(),
		changeCount: num(),
		revision: str(),
	},
	{ open: true },
);

const workspaceCommitDetailValidator = compile(workspaceCommitDetailSchema);
const workspaceCommitHistoryValidator = compile(arr(workspaceCommitSchema));
const workspaceReviewSnapshotValidator = compile(workspaceReviewSnapshotSchema);

export function isWorkspaceCommitDetail<Value>(
	value: Value,
): value is Value & WorkspaceCommitDetail {
	return workspaceCommitDetailValidator.check(value);
}

export function isWorkspaceCommitHistory<Value>(
	value: Value,
): value is Value & WorkspaceCommit[] {
	return workspaceCommitHistoryValidator.check(value);
}

export function isWorkspaceReviewSnapshot<Value>(
	value: Value,
): value is Value & WorkspaceReviewSnapshot {
	return workspaceReviewSnapshotValidator.check(value);
}
