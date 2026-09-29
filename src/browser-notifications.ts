import type { DatastarClientHub } from "./server/datastar-client-hub.ts";

export type SessionDoneNotification = Readonly<{
	workspace: string;
	sessionPath?: string;
}>;

/** Deliver a completion to one connected browser, never to the server's desktop. */
export function notifySessionDone(
	hub: DatastarClientHub,
	details: SessionDoneNotification,
): void {
	// Datastar inserts executeScript as HTML, so even quoted data must not close its script tag.
	const payload = JSON.stringify(details).replaceAll("<", "\\u003c");
	hub.executeOnOneClient(`window.piUi.notifications.show(${payload})`);
}
