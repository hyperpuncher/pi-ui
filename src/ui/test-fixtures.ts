import {
	AppStore,
	type AppStateSnapshot,
	sessionSidebarPageSize,
} from "../state/app-store.ts";

export function appRenderSnapshot(
	overrides: Partial<AppStateSnapshot>,
): AppStateSnapshot {
	const initial = new AppStore().snapshot();
	const sessions = overrides.sessions ?? initial.sessions;
	const sessionSidebarSessions =
		overrides.sessionSidebarSessions ??
		(overrides.sessions
			? sessions.slice(0, sessionSidebarPageSize)
			: initial.sessionSidebarSessions);
	return {
		...initial,
		...overrides,
		sessionSidebarSessions,
		sessionSidebarHasMore:
			overrides.sessionSidebarHasMore ??
			(!overrides.sessionCatalogLoading &&
				sessionSidebarSessions.length < sessions.length),
	};
}
