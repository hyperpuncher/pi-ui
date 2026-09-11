import { responseErrorMessage } from "../utils/errors.ts";
import {
	isWorkspaceCommitDetail,
	isWorkspaceCommitHistory,
	type WorkspaceCommit,
	type WorkspaceCommitDetail,
} from "../workspace-review-types.ts";

export function createWorkspaceReviewApi(endpoint: string) {
	return {
		async loadDiff(
			workspacePath: string,
			path: string | undefined,
			signal: AbortSignal,
		): Promise<string> {
			const query = new URLSearchParams({ workspacePath });
			if (path !== undefined) query.set("path", path);
			const response = await fetch(`${endpoint}/diff?${query}`, { signal });
			if (response.ok) return response.text();
			throw new Error(
				await responseErrorMessage(
					response,
					`Unable to load diff (${response.status})`,
				),
			);
		},

		async discard(path: string): Promise<void> {
			const response = await fetch(`${endpoint}/discard`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ path }),
			});
			if (response.ok) return;
			throw new Error(
				await responseErrorMessage(
					response,
					`Request failed (${response.status})`,
				),
			);
		},

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
