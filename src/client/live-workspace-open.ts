/**
 * Open/close state for the Live Workspace pane, split out of `live-workspace.ts` (which binds
 * listeners and starts a ticking interval at import time) so it can be DOM-tested (O11).
 */

import {
	notifyExternalSurfaceClose,
	notifyExternalSurfaceOpen,
	registerDismissibleSurface,
} from "../../static/app/history-stack.js";
import { isDockedLayout } from "./live-workspace-layout.ts";

/**
 * True only while the pane is both open and presented as an overlay (the mobile sheet or the
 * 48-64rem drawer) rather than grid-docked (>=64rem, see live-workspace.css's `@container`
 * breakpoint) — docked, it's part of the page layout, not a surface a back press should
 * dismiss. Reads the pane's own computed `position` instead of re-deriving the breakpoint
 * here, so this can never drift from the CSS that actually decides it (A#17).
 */
function isOverlayOpen(): boolean {
	const app = document.getElementById("app");
	const pane = document.getElementById("live-workspace");
	if (!app?.classList.contains("live-workspace-open") || !pane) return false;
	return getComputedStyle(pane).position !== "relative";
}

/** Mirrors what `closeLiveWorkspaceAction()` (commands/actions.ts) does from a `data-on` handler. */
function closeLiveWorkspace(): void {
	document
		.getElementById("app")
		?.dispatchEvent(
			new CustomEvent("pi-ui-live-workspace-open", { detail: { open: false } }),
		);
	document.body.dispatchEvent(
		new CustomEvent("pi-ui-live-workspace-preferences", { detail: { open: false } }),
	);
}

/**
 * Binds the pane's open/close behaviour: focus handoff, the Back-button history entry while it
 * floats as an overlay, and adopting (or, per O10, declining) a persisted open state on load.
 * Side-effect free until called, so it can be DOM-tested (O11); `live-workspace.ts` binds the
 * single production instance.
 */
export function bindLiveWorkspace() {
	let open = false;
	// Whether opening the pane as an overlay pushed a history entry that closing must pop
	// (A#17: a back press should close the drawer/sheet, not leave the page).
	let historyEntry = false;
	const applyOpen = (next: boolean) => {
		if (next === open) return;
		open = next;
		const pane = document.getElementById("live-workspace");
		if (!pane) return;
		if (open) {
			requestAnimationFrame(() => {
				pane.querySelector<HTMLElement>(".live-workspace-tab-button")?.focus();
				if (open && !historyEntry && isOverlayOpen()) {
					historyEntry = true;
					notifyExternalSurfaceOpen();
				}
			});
			return;
		}
		if (historyEntry) {
			historyEntry = false;
			notifyExternalSurfaceClose();
		}
		if (pane.contains(document.activeElement)) {
			document.getElementById("live-workspace-toggle")?.focus();
		}
	};
	const unregisterSurface = registerDismissibleSurface({
		// A back press already consumed this surface's history entry; don't pop another.
		close: () => {
			historyEntry = false;
			closeLiveWorkspace();
		},
		isOpen: isOverlayOpen,
	});
	// The pane can already be open on page load (its `open` preference is persisted), and
	// `#app`'s first `data-effect` run can land before this module has replaced main.js's
	// no-op `applyOpen` — so nothing registered the history entry, and on a phone/tablet a
	// back press (Android's, via Capacitor) left the app instead of closing the restored
	// sheet/drawer. Adopt that initial open state here, without moving focus (a cold load
	// must not steal focus from the prompt).
	const adoptInitialOpen = () => {
		const app = document.getElementById("app");
		if (open || !app?.classList.contains("live-workspace-open")) return false;
		// O10: the persisted `open` preference doesn't distinguish a desktop-docked pane from a
		// phone/tablet overlay — restoring it as an overlay would cover the chat the instant the
		// page loads. Only the docked layout auto-restores; elsewhere close it again (without
		// persisting, so the docked preference survives for next time the window is that wide).
		if (!isDockedLayout()) {
			app.dispatchEvent(
				new CustomEvent("pi-ui-live-workspace-open", { detail: { open: false } }),
			);
			return true;
		}
		open = true;
		if (!historyEntry && isOverlayOpen()) {
			historyEntry = true;
			notifyExternalSurfaceOpen();
		}
		return true;
	};
	const app = document.getElementById("app");
	// Only when the server rendered the pane as initially open (the persisted preference) —
	// otherwise a user opening it moments after load must go through `applyOpen` (which also
	// moves focus into the pane), not this focus-less adoption.
	const initiallyOpen =
		app?.getAttribute("data-signals:_live-workspace-open__ifmissing") === "true";
	let observer: MutationObserver | undefined;
	if (app && initiallyOpen && !adoptInitialOpen()) {
		// Datastar may not have applied `data-class` yet; catch the first class change.
		const classObserver = new MutationObserver(() => {
			if (adoptInitialOpen() || open) classObserver.disconnect();
		});
		classObserver.observe(app, { attributeFilter: ["class"], attributes: true });
		setTimeout(() => classObserver.disconnect(), 5000);
		observer = classObserver;
	}
	return {
		applyOpen,
		/** Test-only teardown; the production instance lives for the page's lifetime. */
		dispose: () => {
			unregisterSurface();
			observer?.disconnect();
		},
	};
}
