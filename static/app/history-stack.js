/**
 * Generic browser-history integration for dismissible surfaces (dialogs,
 * the session sidebar drawer, future sheets): pushes a history entry when one
 * opens and pops it again when it closes, so a phone's hardware/gesture back
 * button (Capacitor's `App` plugin falls back to `window.history.back()`)
 * closes the top-most open surface instead of leaving the app with no history
 * to pop on the first press. Every `<dialog>` in this app already fires the
 * native `toggle` event with `evt.newState` (relied on directly by several
 * `data-on:toggle` handlers in page.tsx), so a single capturing listener here
 * covers every modal one — including ones added later — with no per-dialog markup.
 */
export function createDismissibleHistoryGuard(options = {}) {
	const pushState = options.pushState ?? ((state) => history.pushState(state, ""));
	const back = options.back ?? (() => history.back());
	// History entries this guard pushed that are still on the stack. A close only ever pops
	// one of these, never an entry that belongs to the page before pi-ui.
	let depth = 0;
	// `popstate` events caused by this guard's own `back()` calls. They must not be mistaken
	// for a back-button press, which would close a second surface (and pop a second entry).
	let ownPops = 0;

	/** Call when a dismissible surface has just opened. */
	function notifyOpen() {
		depth += 1;
		pushState({ piUiDismissible: true });
	}

	/** Call when a dismissible surface closed for any reason other than a back press. */
	function notifyClose() {
		if (depth === 0) return;
		depth -= 1;
		ownPops += 1;
		back();
	}

	/**
	 * Call on a `popstate` navigation. A back press already removed the top-most surface's
	 * history entry, so close that surface without popping another entry: the caller must not
	 * report that close through `notifyClose()`.
	 */
	function handlePopstate(hasOpenSurface, closeTopmost) {
		if (ownPops > 0) {
			ownPops -= 1;
			return;
		}
		if (depth > 0) depth -= 1;
		if (hasOpenSurface()) closeTopmost();
	}

	return { notifyOpen, notifyClose, handlePopstate };
}

/**
 * A#17: dismissible surfaces that are not a `<dialog>` — today, the Live Workspace pane when
 * it floats as a drawer/sheet instead of being grid-docked (docked, it's part of the layout,
 * not something a back press should dismiss). `bindDismissibleHistory` folds these into the
 * same back-button handling every `<dialog>` already gets, without needing to know their
 * markup. Each entry reports its own open state, since only its owner knows when that's true.
 */
const externalSurfaces = new Set();
/** The guard `bindDismissibleHistory` installed, so non-dialog surfaces can report open/close. */
let boundGuard;

/**
 * Tells the history guard a registered non-dialog surface just opened as a dismissible
 * overlay (dialogs report themselves through their `toggle` event instead).
 */
export function notifyExternalSurfaceOpen() {
	boundGuard?.notifyOpen();
}

/** Counterpart of {@link notifyExternalSurfaceOpen} for a close NOT caused by a back press. */
export function notifyExternalSurfaceClose() {
	boundGuard?.notifyClose();
}

/** Registers a `{ isOpen(), close() }` surface; returns a function that unregisters it. */
export function registerDismissibleSurface(surface) {
	externalSurfaces.add(surface);
	return () => externalSurfaces.delete(surface);
}

function openExternalSurface() {
	for (const surface of externalSurfaces) {
		if (surface.isOpen()) return surface;
	}
	return undefined;
}

/**
 * Modal dialogs whose opening pushed a history entry, in opening order. Non-modal dialogs
 * (the docked session sidebar is a `<dialog>` opened with `show()`) are part of the layout,
 * not something a back press should close, so they are never tracked.
 */
const trackedDialogs = new Set();

function topmostTrackedDialog() {
	let topmost;
	for (const dialog of trackedDialogs) if (dialog.open) topmost = dialog;
	return topmost;
}

function closeTopmostDismissible() {
	const dialog = topmostTrackedDialog();
	if (dialog) {
		// The back press already consumed this dialog's entry: untrack it first so its
		// `toggle` event (dispatched asynchronously, after this returns) pops nothing.
		trackedDialogs.delete(dialog);
		dialog.close();
		return true;
	}
	const surface = openExternalSurface();
	if (surface) {
		surface.close();
		return true;
	}
	return false;
}

function hasOpenDismissible() {
	return topmostTrackedDialog() !== undefined || openExternalSurface() !== undefined;
}

export function bindDismissibleHistory(
	guard = createDismissibleHistoryGuard(),
	documentTarget = document,
	windowTarget = window,
) {
	boundGuard = guard;
	documentTarget.addEventListener(
		"toggle",
		(event) => {
			const dialog = event.target;
			if (!(dialog instanceof HTMLDialogElement)) return;
			if (event.newState === "open") {
				if (trackedDialogs.has(dialog) || !dialog.matches(":modal")) return;
				trackedDialogs.add(dialog);
				guard.notifyOpen();
			} else if (event.newState === "closed" && trackedDialogs.delete(dialog)) {
				guard.notifyClose();
			}
		},
		true,
	);
	windowTarget.addEventListener("popstate", () => {
		guard.handlePopstate(hasOpenDismissible, closeTopmostDismissible);
	});
	// A#17: a dialog REMOVED from the DOM while still open (e.g. a PIUI sheet element the
	// extension retired, or the server simply stopped rendering it on the next morph) never
	// fires `toggle`, so its history entry would otherwise be orphaned. Pop it the same way a
	// normal close would, generically, for every dialog rather than one-off per caller.
	const body = documentTarget.body ?? documentTarget.documentElement ?? documentTarget;
	if (typeof MutationObserver !== "undefined" && body) {
		new MutationObserver(() => {
			for (const dialog of trackedDialogs) {
				if (dialog.isConnected) continue;
				trackedDialogs.delete(dialog);
				guard.notifyClose();
			}
		}).observe(body, { childList: true, subtree: true });
	}
}
