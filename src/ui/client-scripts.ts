/** Imperative browser steps that the server sends after a patch. */
export const clientScripts = {
	focusPrompt: "window.piUi.prompt.autofocus()",
	focusSessionPicker: "document.getElementById('session-input')?.focus()",
	closeWorktreePicker: "document.getElementById('worktree-dialog')?.close()",
	workspaceReviewSubmitted:
		"window.dispatchEvent(new CustomEvent('pi-ui-workspace-review-submitted'))",
	scrollTranscriptBottom: "window.piUi.messageScroll.scrollBottom()",
	openTreeDialog:
		"{ const dialog = document.getElementById('tree-dialog'); if (dialog && !dialog.open) dialog.showModal(); }",
	checkOlderMessages: "window.piUi.messageScroll.checkOlder()",
	holdTranscriptPosition: "window.piUi.messageScroll.holdPosition()",
	restoreTranscriptPosition: "window.piUi.messageScroll.restorePosition()",
} as const;

/** The browser keeps the reading position of each session it leaves. */
export function leaveTranscriptSession(key: string): string {
	return `window.piUi.messageScroll.leaveSession(${JSON.stringify(key)})`;
}

export function enterTranscriptSession(key: string, restored: boolean): string {
	return `window.piUi.messageScroll.enterSession(${JSON.stringify(key)}, ${restored})`;
}
