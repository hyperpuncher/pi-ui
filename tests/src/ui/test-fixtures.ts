import { type AppStateSnapshot, AppStore } from "#src/state/app-store.ts";

/** A default AppStore view with selected fields replaced. */
export function appRenderSnapshot(
	overrides: Partial<AppStateSnapshot>,
): AppStateSnapshot {
	const store = new AppStore();
	const values = {
		...overrides,
		projectRoot:
			overrides.projectRoot ?? overrides.workspacePath ?? store.projectRoot,
	};
	return Object.defineProperties(
		Object.create(store),
		Object.fromEntries(
			Object.entries(values).map(([key, value]) => [key, { value }]),
		),
	);
}
