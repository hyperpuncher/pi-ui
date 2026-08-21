import type { WorkspaceReviewComment } from "../workspace-review-comments.ts";
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

		async submitComments(
			comments: readonly WorkspaceReviewComment[],
		): Promise<boolean> {
			try {
				const response = await fetch(`${endpoint}/submit`, {
					body: JSON.stringify({ comments }),
					headers: { "content-type": "application/json" },
					method: "POST",
				});
				return response.ok;
			} catch {
				return false;
			}
		},
	};
}
