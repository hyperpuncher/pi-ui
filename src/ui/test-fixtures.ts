import { AppStore, type AppStateSnapshot } from "../state/app-store.ts";

export function appRenderSnapshot(
	overrides: Partial<AppStateSnapshot>,
): AppStateSnapshot {
	const defaults = new AppStore().snapshot();
	return {
		...defaults,
		...overrides,
		projectRoot:
			overrides.projectRoot ?? overrides.workspacePath ?? defaults.projectRoot,
	};
}
