import type { AppRenderSnapshot } from "../state/app-store.ts";

export function projectBackendSignals(
	state: AppRenderSnapshot,
): Readonly<Record<string, unknown>> {
	return {
		model: state.currentModel ?? "",
		thinkingLevel: state.thinkingLevel,
		workspacePath: state.workspacePath,
		promptHistory: state.promptHistory,
		isBusy: Boolean(state.activityText),
		isSessionReady: state.sessionTransition.status !== "loading",
		sessionTransitionLoading: state.sessionTransition.status === "loading",
		sessionTransitionVisible: state.sessionTransition.status !== "idle",
		sessionTransitionTarget:
			state.sessionTransition.status === "idle"
				? ""
				: state.sessionTransition.targetPath,
	};
}
