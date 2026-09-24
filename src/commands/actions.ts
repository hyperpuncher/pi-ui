import { endpoints } from "../server/routes/endpoints.ts";
import { previousSessionAction } from "../ui/session-transition.tsx";
import type { AppCommandId } from "./catalog.ts";

export function newSessionAction(temporary = false): string {
	const endpoint = temporary ? endpoints.sessionsNewTemporary : endpoints.sessionsNew;
	return `if (!$_newSessionPending && $_sessionTransitionStatus !== 'loading') { @post('${endpoint}', { payload: {} }); requestAnimationFrame(() => document.getElementById('prompt-input')?.focus()); }`;
}

export function toggleDialogAction(): string {
	return "const dialog = el.commandForElement; dialog.open ? dialog.close() : dialog.showModal();";
}

type CycleDirection = "forward" | "backward" | "event-shift";

function cycleDirectionExpression(direction: CycleDirection): string {
	return direction === "event-shift"
		? "evt.shiftKey ? 'backward' : 'forward'"
		: `'${direction}'`;
}

export function cycleModelAction(direction: CycleDirection): string {
	return `@post('${endpoints.modelCycle}', { payload: { modelCycleDirection: ${cycleDirectionExpression(direction)} } })`;
}

export function cycleThinkingAction(direction: CycleDirection): string {
	return `@post('${endpoints.thinkingCycle}', { payload: { thinkingCycleDirection: ${cycleDirectionExpression(direction)} } })`;
}

export function authDialogAction(mode: "login" | "logout"): string {
	const endpoint =
		mode === "login" ? endpoints.authOpenLogin : endpoints.authOpenLogout;
	return `document.getElementById('command-dialog')?.close(); @post('${endpoint}', { payload: {} })`;
}

function openTreeAction(): string {
	return `@post('${endpoints.treeOpen}', { payload: {} })`;
}

function openWorkspaceDialogAction(
	closeCommandDialog = false,
	action: "open" | "fork" = "open",
): string {
	return `${closeCommandDialog ? "document.getElementById('command-dialog')?.close(); " : ""}$_workspaceAction = '${action}'; document.getElementById('workspace-dialog').showModal()`;
}

export function toggleWorkspaceReviewAction(): string {
	return "$_workspaceReviewOpen = !$_workspaceReviewOpen";
}

/**
 * Sets `$_liveWorkspaceOpen` and persists the new value as the saved preference (A#15):
 * `$_liveWorkspaceOpen` is the live, instantly-applied signal the pane's CSS reads, while
 * `$liveWorkspacePreferences.open` is what's posted to the backend and seeds the signal on the
 * next load — the same split `pi-ui-live-workspace-preferences` event already uses for `tab`
 * and `ratio`.
 */
function setLiveWorkspaceOpenAction(valueExpression: string): string {
	return `
		$_liveWorkspaceOpen = ${valueExpression};
		document.body.dispatchEvent(new CustomEvent(
			'pi-ui-live-workspace-preferences',
			{ detail: { open: $_liveWorkspaceOpen } },
		));
	`;
}

export function toggleLiveWorkspaceAction(): string {
	return setLiveWorkspaceOpenAction("!$_liveWorkspaceOpen");
}

export function closeLiveWorkspaceAction(): string {
	return setLiveWorkspaceOpenAction("false");
}

function toggleKeybindHintsAction(): string {
	return `document.body.toggleAttribute('data-keybind-hints'); @post('${endpoints.keybindHints}', { payload: { keybindHints: document.body.hasAttribute('data-keybind-hints') } })`;
}

export function toggleMinimalModeAction(): string {
	return `$_minimalMode = !$_minimalMode; @post('${endpoints.minimalMode}', { payload: { minimalMode: $_minimalMode } })`;
}

export function toggleToolOutputAction(): string {
	return `$_toolOutputHidden = !$_toolOutputHidden; @post('${endpoints.toolOutput}', { payload: { toolOutputHidden: $_toolOutputHidden } })`;
}

function toggleToolbarAction(): string {
	return `document.body.setAttribute('data-toolbar-animated', ''); document.body.toggleAttribute('data-toolbar-hidden'); @post('${endpoints.toolbar}', { payload: { toolbarHidden: document.body.hasAttribute('data-toolbar-hidden') } })`;
}

export const commandActions = {
	"new-chat": newSessionAction(),
	"new-temporary-chat": newSessionAction(true),
	"resume-session": "document.getElementById('session-dialog').showModal()",
	"previous-session": previousSessionAction(),
	"session-tree": openTreeAction(),
	"command-palette": "document.getElementById('command-input')?.focus()",
	"change-code-theme":
		"document.getElementById('command-dialog')?.close(); window.dispatchEvent(new Event('pi-ui-open-code-theme'))",
	"change-fonts":
		"document.getElementById('command-dialog')?.close(); window.dispatchEvent(new Event('pi-ui-open-fonts'))",
	"toggle-keybind-hints": toggleKeybindHintsAction(),
	"toggle-minimal-mode": `document.getElementById('command-dialog')?.close(); ${toggleMinimalModeAction()}`,
	"toggle-tool-output": `document.getElementById('command-dialog')?.close(); ${toggleToolOutputAction()}`,
	"toggle-toolbar": `document.getElementById('command-dialog')?.close(); ${toggleToolbarAction()}`,
	"switch-model":
		"document.getElementById('command-dialog')?.close(); setTimeout(() => document.getElementById('model-select-trigger')?.click(), 0)",
	"cycle-model": cycleModelAction("forward"),
	"cycle-thinking": cycleThinkingAction("forward"),
	"cycle-thinking-backward": cycleThinkingAction("backward"),
	"toggle-thinking": `document.getElementById('command-dialog')?.close(); @post('${endpoints.thinkingVisibilityToggle}', { payload: {} })`,
	"change-workspace": openWorkspaceDialogAction(true),
	"fork-session-to-workspace": openWorkspaceDialogAction(true, "fork"),
	"toggle-review": toggleWorkspaceReviewAction(),
	"toggle-live-workspace": toggleLiveWorkspaceAction(),
	login: authDialogAction("login"),
	logout: authDialogAction("logout"),
} satisfies Record<AppCommandId, string>;
