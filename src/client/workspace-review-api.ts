import {
	normalizeWorkspaceReviewPreferences,
	type WorkspaceCommit,
	type WorkspaceCommitDetail,
	type WorkspaceReviewPreferences,
	type WorkspaceReviewSnapshot,
} from "../workspace-review-types.ts";

export type WorkspaceReviewUpdateMode = "availability" | "live" | "snapshot";

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
				return (await response.json()) as WorkspaceCommitDetail;
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
				return (await response.json()) as WorkspaceCommit[];
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

		subscribe(
			mode: WorkspaceReviewUpdateMode,
			onSnapshot: (snapshot: WorkspaceReviewSnapshot) => void,
		): EventSource {
			const suffix = mode === "live" ? "" : `?${mode}`;
			const source = new EventSource(`${endpoint}${suffix}`);
			source.addEventListener("message", (event) => {
				onSnapshot(JSON.parse(event.data) as WorkspaceReviewSnapshot);
			});
			return source;
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
