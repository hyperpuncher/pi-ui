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

export async function abortRunningBackgroundSession<
	T extends { status: BackgroundSessionStatus },
>(
	sessions: ReadonlyMap<string, T>,
	path: string,
	abort: (session: T) => Promise<void>,
): Promise<boolean> {
	const session = sessions.get(path);
	if (session?.status !== "running") return false;
	await abort(session);
	session.status = "completed";
	return true;
}
