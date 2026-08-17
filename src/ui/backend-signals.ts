import { sessionTransitionOverlayVisible } from "../agent/session-transition-controller.ts";
import type { AppRenderSnapshot } from "../state/app-store.ts";

export type BackendSignals = {
	_promptHistory: readonly string[];
	_isBusy: boolean;
	_isSessionReady: boolean;
	_sessionTransitionLoading: boolean;
	_sessionTransitionVisible: boolean;
};

export function projectBackendSignals(state: AppRenderSnapshot): BackendSignals {
	return {
		_promptHistory: state.promptHistory,
		_isBusy: Boolean(state.activityText),
		_isSessionReady: state.sessionTransition.status !== "loading",
		_sessionTransitionLoading: state.sessionTransition.status === "loading",
		_sessionTransitionVisible: sessionTransitionOverlayVisible(
			state.sessionTransition,
		),
	};
}
