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

export type WorkspaceReviewSnapshot = Readonly<{
	changes: readonly WorkspaceFileChange[];
	isGitRepository: boolean;
	patch: string;
	revision: string;
}>;
