import type { AppRenderSnapshot } from "../state/app-store.ts";

export function projectBackendSignals(
	state: AppRenderSnapshot,
): Readonly<Record<string, unknown>> {
	return {
		model: state.currentModel ?? "",
		thinkingLevel: state.thinkingLevel,
		workspacePath: state.workspacePath,
		_promptHistory: state.promptHistory,
		_isBusy: Boolean(state.activityText),
		_isSessionReady: state.sessionTransition.status !== "loading",
		_sessionTransitionLoading: state.sessionTransition.status === "loading",
		_sessionTransitionVisible: state.sessionTransition.status !== "idle",
	};
}
