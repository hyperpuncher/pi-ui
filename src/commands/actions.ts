import { endpoints } from "../server/routes/endpoints.ts";
import type { AppCommandId } from "./catalog.ts";

export function newSessionAction(temporary = false): string {
	const endpoint = temporary ? endpoints.sessionsNewTemporary : endpoints.sessionsNew;
	return `if (!$_newSessionPending && !$_sessionTransitionLoading) { @post('${endpoint}', { payload: {} }); requestAnimationFrame(() => document.getElementById('prompt-input')?.focus()); }`;
}

export function openSessionDialogAction(): string {
	return "window.piUi.dialogs.toggleSession()";
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
	return `window.piUi.dialogs.openTree(); @post('${endpoints.treeOpen}', { payload: {} })`;
}

export function openWorkspaceDialogAction(closeCommandDialog = false): string {
	return `${closeCommandDialog ? "document.getElementById('command-dialog')?.close(); " : ""}window.piUi.dialogs.openWorkspace()`;
}

export function toggleWorkspaceDialogAction(): string {
	return "window.piUi.dialogs.toggleWorkspace()";
}

export function toggleWorkspaceReviewAction(): string {
	return "$_workspaceReviewOpen = !$_workspaceReviewOpen";
}

export function togglePopoverAction(triggerId: string): string {
	return `window.piUi.dialogs.togglePopover(${JSON.stringify(triggerId)})`;
}

export const commandActions = {
	"new-chat": newSessionAction(),
	"new-temporary-chat": newSessionAction(true),
	"resume-session": openSessionDialogAction(),
	"session-tree": openTreeAction(),
	"command-palette": "document.getElementById('command-input')?.focus()",
	"change-code-theme":
		"document.getElementById('command-dialog')?.close(); window.dispatchEvent(new Event('pi-ui-open-code-theme'))",
	"switch-model": `setTimeout(() => ${togglePopoverAction("model-select-trigger")}, 0)`,
	"cycle-model": cycleModelAction("forward"),
	"cycle-thinking": cycleThinkingAction("forward"),
	"cycle-thinking-backward": cycleThinkingAction("backward"),
	"change-workspace": openWorkspaceDialogAction(true),
	"toggle-review": toggleWorkspaceReviewAction(),
	login: authDialogAction("login"),
	logout: authDialogAction("logout"),
} satisfies Record<AppCommandId, string>;
