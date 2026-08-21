import {
	isWorkspaceCommitDetail,
	isWorkspaceCommitHistory,
	type WorkspaceCommit,
	type WorkspaceCommitDetail,
} from "../workspace-review-types.ts";

export function createWorkspaceReviewApi(endpoint: string) {
	return {
		async loadCommit(hash: string): Promise<WorkspaceCommitDetail | undefined> {
			try {
				const response = await fetch(
					`${endpoint}/commit?hash=${encodeURIComponent(hash)}`,
					{ headers: { accept: "application/json" } },
				);
				if (!response.ok) return undefined;
				const value = await response.json();
				return isWorkspaceCommitDetail(value) ? value : undefined;
			} catch {
				return undefined;
			}
		},

		async loadHistory(offset: number): Promise<WorkspaceCommit[] | undefined> {
			try {
				const response = await fetch(`${endpoint}/history?offset=${offset}`, {
					headers: { accept: "application/json" },
				});
				if (!response.ok) return undefined;
				const value = await response.json();
				return isWorkspaceCommitHistory(value) ? value : undefined;
			} catch {
				return undefined;
			}
		},
	};
}
