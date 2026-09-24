/**
 * Client-side companion for the Live Workspace pane: ticks the "Now" and "Activity" tabs'
 * relative/elapsed-time labels and the retry countdown (server-rendered timestamps go stale
 * the moment the page sits idle — A#26) and moves focus in and out of the pane when it opens
 * and closes, mirroring `workspace-review.ts`'s `applyOpen` pattern without that file's
 * git-availability gating, which Live Workspace has no equivalent of.
 */

import { formatRetryCountdown } from "../live-workspace-types.ts";
import { bindLiveWorkspace } from "./live-workspace-open.ts";

const tickIntervalMs = 1000;

function formatElapsed(ms: number): string {
	const totalSeconds = Math.max(0, Math.round(ms / 1000));
	if (totalSeconds < 60) return `${totalSeconds}s`;
	const totalMinutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	if (totalMinutes < 60) return `${totalMinutes}m ${seconds}s`;
	const hours = Math.floor(totalMinutes / 60);
	const minutes = totalMinutes % 60;
	return `${hours}h ${minutes}m`;
}

function tickElapsed(): void {
	const now = Date.now();
	for (const element of document.querySelectorAll<HTMLElement>(
		"[data-live-workspace-elapsed]",
	)) {
		const at = Number(element.dataset.liveWorkspaceElapsed);
		if (!Number.isFinite(at)) continue;
		const text = formatElapsed(now - at);
		// Only write on change: the MutationObserver below re-ticks on every DOM change, and an
		// unconditional write would itself count as one.
		if (element.textContent !== text) element.textContent = text;
	}
	for (const element of document.querySelectorAll<HTMLElement>(
		"[data-live-workspace-retry-at]",
	)) {
		const at = Number(element.dataset.liveWorkspaceRetryAt);
		if (!Number.isFinite(at)) continue;
		const text = formatRetryCountdown(at - now);
		if (element.textContent !== text) element.textContent = text;
	}
}

function requestNotificationPermission(): void {
	if (typeof Notification === "undefined" || Notification.permission !== "default")
		return;
	void Notification.requestPermission();
}

/** Reads the toggle's own `aria-pressed`, which the server keeps in sync with the persisted
 * `liveWorkspacePreferences.notifications` signal — avoids a second source of truth here. */
function notificationsOptedIn(): boolean {
	return (
		document
			.getElementById("live-workspace-notifications-toggle")
			?.getAttribute("aria-pressed") === "true"
	);
}

/**
 * Opt-in Notification API integration (Live Workspace depth, Round 2): tells the person a turn
 * finished or is waiting for extension input while they're on another tab or app, so they don't
 * have to keep pi-ui in view. Silently does nothing without permission or opt-in, and never on
 * a visible page — no point interrupting someone already looking at the answer.
 */
function notifyTurnEvent(title: string, body: string): void {
	if (
		typeof Notification === "undefined" ||
		Notification.permission !== "granted" ||
		!notificationsOptedIn() ||
		!document.hidden
	) {
		return;
	}
	try {
		const notification = new Notification(title, {
			body,
			tag: "pi-ui-live-workspace-turn",
		});
		notification.addEventListener("click", () => {
			window.focus();
			notification.close();
		});
	} catch {
		// Some embedders (webviews, permission edge cases) can still throw here; never let a
		// notification failure break the app.
	}
}

/** Watches the always-rendered "Now" tab turn banner for phase transitions, independent of
 * whether the pane itself is open — notifications should fire even while it's closed. */
function watchTurnPhase(): void {
	const now = document.getElementById("live-workspace-now");
	if (!now) return;
	let previousPhase: string | undefined;
	const readPhase = () =>
		now.querySelector<HTMLElement>(".live-workspace-turn-banner")?.dataset.turnPhase;
	previousPhase = readPhase();
	new MutationObserver(() => {
		const phase = readPhase();
		if (phase === previousPhase) return;
		const previous = previousPhase;
		previousPhase = phase;
		if (phase === "waiting-for-extension") {
			notifyTurnEvent("pi is waiting for input", "Open pi-ui to respond.");
		} else if (
			phase === undefined &&
			(previous === "running" || previous === "retrying")
		) {
			notifyTurnEvent("Turn finished", "pi has finished the current turn.");
		}
	}).observe(now, {
		attributeFilter: ["data-turn-phase"],
		attributes: true,
		childList: true,
		subtree: true,
	});
}

window.piUi.liveWorkspace = {
	applyOpen: bindLiveWorkspace().applyOpen,
	requestNotificationPermission,
};

watchTurnPhase();
tickElapsed();
setInterval(tickElapsed, tickIntervalMs);
// Every SSE patch of a tab re-renders its elapsed/countdown spans empty (the server only
// renders the timestamp); fill them right away instead of leaving them blank until the next
// 1s tick, which made active-tool and activity times flicker on every streamed update.
let tickQueued = false;
const livePane = document.getElementById("live-workspace");
if (livePane) {
	new MutationObserver(() => {
		if (tickQueued) return;
		tickQueued = true;
		queueMicrotask(() => {
			tickQueued = false;
			tickElapsed();
		});
	}).observe(livePane, { childList: true, subtree: true });
}
