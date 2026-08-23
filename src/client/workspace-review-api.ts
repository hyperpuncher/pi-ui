import { isRecord, isString } from "../utils/type-guards.ts";
import {
	isWorkspaceCommitDetail,
	isWorkspaceCommitHistory,
	type WorkspaceCommit,
	type WorkspaceCommitDetail,
} from "../workspace-review-types.ts";

export function createWorkspaceReviewApi(endpoint: string) {
	return {
		async discard(path: string): Promise<void> {
			const response = await fetch(`${endpoint}/discard`, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ path }),
			});
			if (response.ok) return;
			let message = `Request failed (${response.status})`;
			try {
				const value: unknown = await response.json();
				if (isRecord(value) && isString(value.error)) {
					message = value.error;
				}
			} catch {
				// Keep the status fallback when the response is not JSON.
			}
			throw new Error(message);
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
