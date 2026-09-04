import { AppStore, type AppStateSnapshot } from "../state/app-store.ts";

export function appRenderSnapshot(
	overrides: Partial<AppStateSnapshot>,
): AppStateSnapshot {
	return {
		...new AppStore().snapshot(),
		...overrides,
	};
}
