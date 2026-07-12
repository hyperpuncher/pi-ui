import { endpoints } from "../server/routes/endpoints.ts";
import type { AppCommandId } from "./catalog.ts";

const emptySignals = "filterSignals: { include: /^$/ }";

export function newSessionAction(temporary = false): string {
	const endpoint = temporary ? endpoints.sessionsNewTemporary : endpoints.sessionsNew;
	const target = temporary ? "New temporary session" : "New session";
	return `if (!$sessionTransitionLoading) { $_sessionTarget = '${target}'; @post('${endpoint}', { ${emptySignals} }); requestAnimationFrame(() => document.getElementById('prompt-input')?.focus()); }`;
}

export function openSessionDialogAction(): string {
	return `window.piUi.dialogs.openSession(); @post('${endpoints.sessionsList}', { ${emptySignals} })`;
}

type CycleDirection = "forward" | "backward" | "event-shift";

function cycleDirectionExpression(direction: CycleDirection): string {
	return direction === "event-shift"
		? "evt.shiftKey ? 'backward' : 'forward'"
		: `'${direction}'`;
}

export function cycleModelAction(direction: CycleDirection): string {
	return `$modelCycleDirection = ${cycleDirectionExpression(direction)}; @post('${endpoints.modelCycle}', { filterSignals: { include: /^modelCycleDirection$/ } })`;
}

export function cycleThinkingAction(direction: CycleDirection): string {
	return `$thinkingCycleDirection = ${cycleDirectionExpression(direction)}; @post('${endpoints.thinkingCycle}', { filterSignals: { include: /^thinkingCycleDirection$/ } })`;
}

export function authDialogAction(mode: "login" | "logout"): string {
	const endpoint =
		mode === "login" ? endpoints.authOpenLogin : endpoints.authOpenLogout;
	return `document.getElementById('command-dialog')?.close(); @post('${endpoint}', { ${emptySignals} })`;
}

export function openTreeAction(): string {
	return `window.piUi.dialogs.openTree(); @post('${endpoints.treeOpen}', { ${emptySignals} })`;
}

export function openWorkspaceDialogAction(closeCommandDialog = false): string {
	return `${closeCommandDialog ? "document.getElementById('command-dialog')?.close(); " : ""}window.piUi.dialogs.openWorkspace()`;
}

export const commandActions = {
	"new-chat": newSessionAction(),
	"new-temporary-chat": newSessionAction(true),
	"resume-session": openSessionDialogAction(),
	"session-tree": openTreeAction(),
	"command-palette": "document.getElementById('command-input')?.focus()",
	"switch-model":
		"setTimeout(() => { document.getElementById('model-select-trigger')?.focus(); document.getElementById('model-select')?.toggle?.(); }, 0)",
	"cycle-model": cycleModelAction("forward"),
	"cycle-thinking": cycleThinkingAction("forward"),
	"cycle-thinking-backward": cycleThinkingAction("backward"),
	"change-workspace": openWorkspaceDialogAction(true),
	login: authDialogAction("login"),
	logout: authDialogAction("logout"),
} satisfies Record<AppCommandId, string>;
