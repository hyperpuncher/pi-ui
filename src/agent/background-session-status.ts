import type { AppSessionSummary, BackgroundSessionStatus } from "../state/app-store.ts";

export function mergeBackgroundSessionStatuses(
	sessions: readonly AppSessionSummary[],
	statuses: ReadonlyMap<string, BackgroundSessionStatus>,
	currentSessionPath?: string,
): AppSessionSummary[] {
	return sessions.map((session) => {
		const { backgroundStatus: _backgroundStatus, ...summary } = session;
		const backgroundStatus =
			session.path === currentSessionPath ? undefined : statuses.get(session.path);
		return backgroundStatus ? { ...summary, backgroundStatus } : summary;
	});
}
