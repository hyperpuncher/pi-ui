import { sessionTransitionOverlayVisible } from "../agent/session-transition-controller.ts";
import { getPierreThemes } from "../pierre-theme.ts";
import type { AppStateSnapshot } from "../state/app-store.ts";

export type BackendSignals = {
	_codeThemeDark: string;
	_codeThemeLight: string;
	_promptHistory: readonly string[];
	_isBusy: boolean;
	_isSessionReady: boolean;
	_thinkingHidden: boolean;
	_sessionTransitionLoading: boolean;
	_sessionTransitionVisible: boolean;
	_workspaceReviewPreferences: AppStateSnapshot["workspaceReviewPreferences"];
};

export function projectBackendSignals(state: AppStateSnapshot): BackendSignals {
	const codeThemes = getPierreThemes();
	return {
		_codeThemeDark: codeThemes.dark,
		_codeThemeLight: codeThemes.light,
		_promptHistory: state.promptHistory,
		_isBusy: Boolean(state.activityText),
		_isSessionReady: state.sessionTransition.status !== "loading",
		_thinkingHidden: state.thinkingHidden,
		_sessionTransitionLoading: state.sessionTransition.status === "loading",
		_sessionTransitionVisible: sessionTransitionOverlayVisible(
			state.sessionTransition,
		),
		_workspaceReviewPreferences: state.workspaceReviewPreferences,
	};
}
