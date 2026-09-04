import { sessionTransitionOverlayVisible } from "../agent/session-transition-controller.ts";
import { getActiveFonts } from "../fonts.ts";
import { getPierreThemes } from "../pierre-theme.ts";
import type { AppStateSnapshot } from "../state/app-store.ts";

export type BackendSignals = {
	_codeThemeDark: string;
	_codeThemeLight: string;
	_fontMono: string;
	_fontSans: string;
	_promptHistory: readonly string[];
	_isBusy: boolean;
	_thinkingHidden: boolean;
	_sessionTransitionGeneration: number;
	_sessionTransitionLoading: boolean;
	_sessionTransitionStatus: AppStateSnapshot["sessionTransition"]["status"];
	_sessionTransitionVisible: boolean;
	_workspaceReviewAdditions: number;
	_workspaceReviewBranch: string;
	_workspaceReviewDeletions: number;
	_workspaceReviewGitAvailable: boolean;
	_workspaceReviewChangeCount: number;
};

export function projectBackendSignals(state: AppStateSnapshot): BackendSignals {
	const codeThemes = getPierreThemes();
	const fonts = getActiveFonts();
	return {
		_codeThemeDark: codeThemes.dark,
		_codeThemeLight: codeThemes.light,
		_fontMono: fonts.mono,
		_fontSans: fonts.sans,
		_promptHistory: state.promptHistory,
		_isBusy: Boolean(state.activityText),
		_thinkingHidden: state.thinkingHidden,
		_sessionTransitionGeneration: state.sessionTransition.generation,
		_sessionTransitionLoading: state.sessionTransition.status === "loading",
		_sessionTransitionStatus: state.sessionTransition.status,
		_sessionTransitionVisible: sessionTransitionOverlayVisible(
			state.sessionTransition,
		),
		_workspaceReviewAdditions: state.workspaceReview.changes.reduce(
			(total, change) => total + change.additions,
			0,
		),
		_workspaceReviewBranch: state.workspaceReview.branch ?? "",
		_workspaceReviewDeletions: state.workspaceReview.changes.reduce(
			(total, change) => total + change.deletions,
			0,
		),
		_workspaceReviewGitAvailable: state.workspaceReview.isGitRepository,
		_workspaceReviewChangeCount: state.workspaceReview.changes.length,
	};
}
