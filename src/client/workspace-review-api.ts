import type { WorkspaceReviewComment } from "../workspace-review-comments.ts";
import {
	isWorkspaceCommitDetail,
	isWorkspaceCommitHistory,
	normalizeWorkspaceReviewPreferences,
	type WorkspaceCommit,
	type WorkspaceCommitDetail,
	type WorkspaceReviewPreferences,
} from "../workspace-review-types.ts";

export function createWorkspaceReviewApi(endpoint: string) {
	const preferencesEndpoint = `${endpoint}/preferences`;
	let preferenceWrites = Promise.resolve();

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

		async readPreferences(): Promise<WorkspaceReviewPreferences> {
			try {
				const response = await fetch(preferencesEndpoint, {
					cache: "no-store",
					headers: { accept: "application/json" },
					signal: AbortSignal.timeout(2_000),
				});
				if (!response.ok) return {};
				return normalizeWorkspaceReviewPreferences(await response.json());
			} catch {
				return {};
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

		writePreferences(preferences: WorkspaceReviewPreferences): void {
			const body = JSON.stringify(preferences);
			preferenceWrites = preferenceWrites
				.then(async () => {
					const response = await fetch(preferencesEndpoint, {
						body,
						headers: { "content-type": "application/json" },
						keepalive: true,
						method: "POST",
					});
					if (!response.ok) {
						throw new Error("Unable to save Git view preferences");
					}
				})
				.catch(() => {});
		},
	};
}
