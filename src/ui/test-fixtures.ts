import { type AppRenderSnapshot, AppStore } from "../state/app-store.ts";

export function appRenderSnapshot(
	overrides: Partial<AppRenderSnapshot>,
): AppRenderSnapshot {
	return { ...new AppStore().snapshot(), ...overrides };
}
