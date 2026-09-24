import { endpoints } from "../../src/server/routes/endpoints.ts";
import { promptInput } from "./prompt.js";
import { encodeKeyEvent } from "./terminal-keys.js";

/**
 * Client-side companion for `pi.registerShortcut()` (F1 §1) and prompt-level
 * `ctx.ui.onTerminalInput` forwarding (F1 §2). Both read the hidden data
 * island `prompt-status.tsx` renders (`#extension-shortcuts-data`) fresh on
 * every keydown rather than caching it, so a session/extension switch never
 * leaves this module holding a stale shortcut list.
 *
 * Precedence ("never overriding pi-ui's own keybinds unless pi's TUI would
 * give the extension precedence — mirror the TUI's precedence rules", plan
 * F1 §1): the server already excludes any extension shortcut that collides
 * with pi-ui's own keybind catalog or a reserved pi-tui built-in (see
 * `extension-shortcuts.ts`), so a matched shortcut here can never be one of
 * pi-ui's own. On top of that, `handleShortcutKeydown` only ever matches
 * AFTER pi-ui's own handlers for the SAME event have run (any handler that
 * already called `preventDefault()` — including the prompt textarea's own
 * inline Escape/Enter handling — is skipped via `event.defaultPrevented`) —
 * mirroring the *shape* of the TUI's own layered dispatch (raw
 * `onTerminalInput` listeners first, then focused-component handling) without
 * needing to reproduce every one of its internal precedence rules, since the
 * exclusion above already prevents the cases where getting that order wrong
 * would matter.
 *
 * Prompt-level `onTerminalInput` forwarding only intercepts a bounded
 * "candidate" set — Escape unconditionally, an Alt/Ctrl + printable-character
 * chord that isn't a platform editing or browser shortcut, and arrows/a single
 * unmodified character only while the prompt is empty — so ordinary
 * multi-line typing and cursor movement (Ctrl+Arrow word jumps and
 * Ctrl+Home/End included) never pay a round trip; see `isForwardCandidate`'s
 * doc comment. Forwarding a candidate always preventDefault()s it up front (the
 * round trip has to decide first), which also stands down prompt-box.tsx's
 * own target-phase handling for that same keypress — including its
 * Escape-blurs-the-prompt convenience, since that handler runs on the
 * textarea itself and always fires before this module's `document`-level
 * listener ever sees the event (see `promptLevelInputActive`'s doc comment).
 * A consumed key never reaches the textarea; an unconsumed one is played back
 * at the caret (or, for Escape, blurs the prompt via `blurPromptIfIdle`)
 * exactly as if this module had never intercepted it. While a forward is in
 * flight, later editing keys queue behind it (see `handlePromptLevelKeydown`)
 * so fast typing is never reordered or dropped.
 */

const dataIslandId = "extension-shortcuts-data";
const promptInputId = "prompt-input";
const captureIndicatorId = "extension-capture-indicator";
const captureIndicatorMs = 1500;

const keyIdTokenAliases = {
	escape: "Escape",
	esc: "Escape",
	enter: "Enter",
	return: "Enter",
	tab: "Tab",
	space: " ",
	backspace: "Backspace",
	delete: "Delete",
	insert: "Insert",
	clear: "Clear",
	home: "Home",
	end: "End",
	pageup: "PageUp",
	pagedown: "PageDown",
	up: "ArrowUp",
	down: "ArrowDown",
	left: "ArrowLeft",
	right: "ArrowRight",
	f1: "F1",
	f2: "F2",
	f3: "F3",
	f4: "F4",
	f5: "F5",
	f6: "F6",
	f7: "F7",
	f8: "F8",
	f9: "F9",
	f10: "F10",
	f11: "F11",
	f12: "F12",
};

/** Matches a base (non-modifier) `KeyId` token — everything after the last
 * `+` — against a `KeyboardEvent`. Special-key tokens compare against
 * `event.key`'s named form; a single-character token compares
 * case-insensitively for a letter (pi-tui's `KeyId` letters are always
 * lowercase regardless of Shift, which is its own explicit modifier bit) and
 * literally otherwise (pi-tui's `SymbolKey` union already lists shifted
 * punctuation like `"!"` as its own base key, so `event.key` — which a
 * browser already reports as `"!"` when Shift+1 is pressed on a US layout —
 * needs no further shift handling here). */
function matchesBaseToken(event, token) {
	const mapped = keyIdTokenAliases[token];
	if (mapped !== undefined) return event.key === mapped;
	if (token.length !== 1) return false;
	if (/[a-z]/.test(token)) return event.key.toLowerCase() === token;
	return event.key === token;
}

/**
 * Matches a `KeyboardEvent` against a pi-tui `KeyId` string (`"alt+o"`,
 * `"ctrl+shift+p"`, `"escape"`) the way `ExtensionRunner.getShortcuts()` keys
 * its map and `matchesKey()`/`parseKey()` (`@earendil-works/pi-tui`'s
 * `dist/keys.js`) would over the raw terminal bytes those same keys encode
 * to. Every modifier the `KeyId` names must be held, and every one it
 * doesn't must NOT be held — an unqualified `"o"` never matches Alt+O, and
 * `"alt+o"` never matches Ctrl+Alt+O.
 */
export function matchesKeyId(event, keyId) {
	const parts = keyId.toLowerCase().split("+");
	const base = parts.pop();
	if (base === undefined) return false;
	const mods = new Set(parts);
	if (event.ctrlKey !== mods.has("ctrl")) return false;
	if (event.altKey !== mods.has("alt")) return false;
	if (event.metaKey !== mods.has("super")) return false;
	if (event.shiftKey !== mods.has("shift")) return false;
	return matchesBaseToken(event, base);
}

/** Base keys (case-insensitive) a Ctrl-chord already means something to the
 * browser/OS for — copy, paste, cut, select-all, undo, redo — plus Ctrl+
 * Backspace's "delete previous word". Round 6 F1: never forwarded, exactly
 * like Escape/Enter/arrows already never touch these; an extension that wants
 * one of these chords for itself is out of luck, same as it would be against
 * a real terminal emulator's own copy/paste bindings. */
const nativeEditingChordKeys = new Set(["c", "v", "x", "a", "z", "y"]);

/** Whether `event` is a Ctrl-chord the platform already gives a fixed editing
 * meaning to (see `nativeEditingChordKeys`) — checked before Alt is even
 * considered, since these are Ctrl-only bindings (Ctrl+Alt+C etc. are a
 * distinct, unclaimed chord). */
function isNativeEditingChord(event) {
	if (!event.ctrlKey || event.altKey || event.metaKey) return false;
	if (event.key === "Backspace") return true;
	return nativeEditingChordKeys.has(event.key.toLowerCase());
}

/** Base keys (case-insensitive, Shift ignored) a Ctrl-chord already means
 * something to the browser for that a page *can* cancel but a user still
 * expects from the prompt — find/find-next, print, save, reload, the address
 * and search bars, history, downloads, devtools, view-source, open, bookmark,
 * and page zoom. Forwarding preventDefault()s a key before the round trip and
 * none of these can be replayed afterwards, so forwarding them would break
 * them for as long as any extension listener is registered (in practice the
 * whole session). A `registerShortcut()` on one of these still fires: shortcut
 * matching (`handleShortcutKeydown`) runs whenever forwarding declines. */
const browserCtrlChordKeys = new Set([..."defghijklopqrsu", "=", "+", "-", "_", "0"]);

/** Whether a Ctrl/Alt chord (IME, Meta and AltGraph already ruled out) is one
 * to forward. The base must be a single printable ASCII character: a named
 * key under a modifier is the textarea's own navigation or editing (Ctrl+Arrow
 * word jump, Ctrl+Shift+Arrow word select, Ctrl+Home/End, Ctrl+Delete, macOS
 * Alt+Arrow/Alt+Backspace) or browser chrome (Ctrl+Tab, F-keys), none of which
 * `applyKeyLocally` could replay faithfully if unconsumed, and a non-ASCII
 * base under Alt is macOS Option text input (Option+O types "ø"). Ctrl-only
 * chords also skip the platform editing chords (`isNativeEditingChord`) and
 * the browser's own (`browserCtrlChordKeys`). */
function isForwardableChord(event) {
	if (event.key.length !== 1 || event.key < " " || event.key > "~") return false;
	if (event.ctrlKey && !event.altKey) {
		if (isNativeEditingChord(event)) return false;
		if (browserCtrlChordKeys.has(event.key.toLowerCase())) return false;
	}
	return true;
}

/**
 * Whether `event` is a candidate for prompt-level `onTerminalInput`
 * forwarding (F1 §2). Escape is always a candidate — extension state (a
 * pending confirmation, a manage-mode toggle) can legitimately want it
 * regardless of what else is in the prompt, and forwarding it costs nothing:
 * it never inserts a character, so preventing its (nonexistent) default and
 * awaiting the server's answer is invisible either way. Arrows and a single
 * unmodified character are candidates only while the prompt is empty — the
 * only state where every extension observed using them (`bash-background.ts`,
 * `subagents.ts` manage mode) actually reads them — so a normal multi-line
 * edit's cursor movement and typing never wait on a round trip.
 *
 * Round 6 F1: an Alt+key or Ctrl+key chord is also a candidate, regardless of
 * prompt contents — real interactive-mode's raw `onTerminalInput` listeners
 * (`ask-user.ts`'s `alt+o` overlay toggle, `subagents.ts` manage mode) see
 * every keystroke including modifier chords, and no ordinary typing or prompt
 * editing ever holds Ctrl/Alt, so there's no per-keystroke cost to widening
 * this the way there would be for plain characters. Like the TUI (whose raw
 * listeners run before the editor's app keybindings), a listener answers
 * first: `handlePromptLevelKeydown` holds a forwarded chord back from pi-ui's
 * own `window`-level keybinds (`src/keybinds.ts`), and only an unconsumed one
 * reaches them — after any matching `registerShortcut()` shortcut — via
 * `replayToWindow`, so a chord an extension consumes (Alt+O restoring a hidden
 * workflow view) never also toggles pi-ui's own bind. Excluded outright: the platform's own editing chords
 * (`isNativeEditingChord`), IME composition, AltGraph (accented/special
 * characters on many non-US layouts arrive as `altKey: true` with
 * `getModifierState("AltGraph")`), Cmd/Meta chords (macOS/Chrome-OS reserved,
 * same as before), a bare modifier keydown with no base key yet, and every
 * chord `isForwardableChord` declines (modified navigation keys such as
 * Ctrl+Arrow word jumps, macOS Option text, browser Ctrl chords).
 */
export function isForwardCandidate(event, promptEmpty) {
	if (event.key === "Escape") return true;
	if (event.isComposing) return false;
	if (event.metaKey) return false;
	if (event.getModifierState?.("AltGraph")) return false;
	if (event.ctrlKey || event.altKey) return isForwardableChord(event);
	if (!promptEmpty) return false;
	if (
		event.key === "ArrowUp" ||
		event.key === "ArrowDown" ||
		event.key === "ArrowLeft" ||
		event.key === "ArrowRight"
	) {
		return true;
	}
	return event.key.length === 1;
}

function dataIsland() {
	return document.getElementById(dataIslandId);
}

/** Only shortcuts pi-ui's own keybinds don't already claim — one flagged
 * `reachableByKeyboard: false` (colliding with a pi-ui bind) is still listed
 * in the data island for the `/hotkeys` dialog and command palette, but is
 * never matched here; see `AppExtensionShortcut`'s doc comment. */
function currentShortcutKeys() {
	const container = dataIsland();
	if (!container) return [];
	return [...container.children].flatMap((el) => {
		const keyId = el.dataset.key ?? "";
		return keyId && el.dataset.reachable !== undefined ? [keyId] : [];
	});
}

/**
 * Whether some `ctx.ui.onTerminalInput` listener is currently registered
 * outside a focused terminal surface — exposed on `window.piUi.extensionKeys`
 * (see `main.js`) so `prompt-box.tsx`'s own inline Escape-blurs-the-prompt
 * handling can stand down while an extension *might* want the very next
 * Escape, instead of racing this module's own (bubble-phase, later-running)
 * forwarding for the same keypress: prompt-box.tsx's handler is on the
 * textarea itself, so it always runs (at the "target" phase) before this
 * module's `document`-level (bubble-phase) listener ever sees the event, and
 * whether an extension actually wants THIS keypress can only be known after
 * an async round trip — too late for prompt-box.tsx's synchronous handler to
 * wait on. So this flag is necessarily coarser than one keypress: it stays
 * true for as long as `bash-background.ts`/`subagents.ts`-style extensions
 * keep a listener registered, which in practice is the whole session, not
 * just while their own "manage mode" is active — meaning most forwarded keys
 * still come back `{consumed: false}`. `handlePromptLevelKeydown` restores
 * prompt-box.tsx's own Escape-blur behavior itself in exactly that case (see
 * its doc comment and `blurPromptIfIdle`) — round-5 runtime-validation
 * finding, fixed in two parts across both modules.
 */
export function promptLevelInputActive() {
	return dataIsland()?.dataset.terminalInputActive !== undefined;
}

/** Only while focus is the prompt itself (or nothing/`<body>`, e.g. right
 * after a page load) — never while a dialog, a terminal surface's hidden
 * input proxy, or any other native control owns it. */
function focusInScope() {
	const active = document.activeElement;
	if (active === null || active === document.body) return true;
	return active.id === promptInputId;
}

async function postJson(url, body) {
	const response = await fetch(url, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
	return response;
}

function invokeShortcut(keyId) {
	// Fire-and-forget, like pi-tui's own `Promise.resolve(handler(...)).catch(...)`
	// (`setupExtensionShortcuts`): the server runs the handler asynchronously and
	// reports a failure as a notice, so there is nothing useful to await here.
	void postJson(endpoints.extensionShortcutInvoke, { keyId }).catch(() => {
		// Best-effort, matching terminal-keys.js's `postJson`: a dropped
		// keystroke on a flaky connection isn't worth surfacing.
	});
}

/** Keys preventDefault()'d at dispatch and waiting to be forwarded or played
 * back, oldest first. Serialized so two keys typed within one round trip can
 * never race: each one's forward decision and fallback runs against the
 * prompt as every earlier key left it. */
const pendingKeys = [];
let draining = false;
let replaying = false;

let captureIndicatorTimer;

function flashCaptureIndicator() {
	const indicator = document.getElementById(captureIndicatorId);
	if (!indicator) return;
	indicator.hidden = false;
	clearTimeout(captureIndicatorTimer);
	captureIndicatorTimer = setTimeout(() => {
		indicator.hidden = true;
	}, captureIndicatorMs);
}

/** Keys that, once a forward is in flight, must wait their turn behind it so
 * they apply to the prompt in the order they were typed (see
 * `handlePromptLevelKeydown`). Everything else — modifier chords, Tab,
 * Home/End, IME composition — keeps its native, immediate behavior. */
const orderedEditingKeys = new Set([
	"Backspace",
	"Delete",
	"Enter",
	"Escape",
	"ArrowUp",
	"ArrowDown",
	"ArrowLeft",
	"ArrowRight",
]);

function isOrderedKey(event) {
	if (event.ctrlKey || event.metaKey || event.altKey) return false;
	return event.key.length === 1 || orderedEditingKeys.has(event.key);
}

/** Replaces the prompt's current selection with `text` (`""` deletes it) and
 * fires a real `input` event for Datastar's `data-bind:prompt`, the way native
 * editing would. Relative to the live value and caret — never an overwrite —
 * so keys applied after a round trip never clobber anything typed since. */
function replaceSelection(input, text, start, end) {
	input.setRangeText(text, start, end, "end");
	input.dispatchEvent(new Event("input", { bubbles: true }));
}

/** Plays a key this module preventDefault()'d (and no listener consumed) back
 * into the prompt: the native default action for editing keys, and, for a
 * plain Enter, `prompt-box.tsx`'s own submit handling via a non-bubbling
 * synthetic keydown (non-bubbling so window-level keybinds, which already saw
 * the original event, don't fire twice). */
function applyKeyLocally(input, event) {
	const start = input.selectionStart;
	const end = input.selectionEnd;
	const collapsed = start === end;
	switch (event.key) {
		case "Enter": {
			if (!event.shiftKey) {
				const replay = new KeyboardEvent("keydown", {
					key: "Enter",
					code: event.code,
					bubbles: false,
					cancelable: true,
				});
				replaying = true;
				try {
					input.dispatchEvent(replay);
				} finally {
					replaying = false;
				}
				if (replay.defaultPrevented) return;
			}
			replaceSelection(input, "\n", start, end);
			return;
		}
		case "Backspace":
			if (!collapsed) replaceSelection(input, "", start, end);
			else if (start > 0) replaceSelection(input, "", start - 1, start);
			return;
		case "Delete":
			if (!collapsed) replaceSelection(input, "", start, end);
			else if (end < input.value.length) replaceSelection(input, "", end, end + 1);
			return;
		case "ArrowLeft":
		case "ArrowUp": {
			if (replayHistoryKey(input, event)) return;
			const caret = collapsed
				? event.key === "ArrowUp"
					? 0
					: Math.max(0, start - 1)
				: start;
			input.setSelectionRange(caret, caret);
			return;
		}
		case "ArrowRight":
		case "ArrowDown": {
			if (replayHistoryKey(input, event)) return;
			const length = input.value.length;
			const caret = collapsed
				? event.key === "ArrowDown"
					? length
					: Math.min(length, end + 1)
				: end;
			input.setSelectionRange(caret, caret);
			return;
		}
		default:
			// A modifier chord (Alt+O, Ctrl+M, …) unconsumed by any extension has no
			// text to insert — a matching shortcut or pi-ui's own keybind already
			// got it in `processPendingKey`; otherwise the chord is simply a no-op,
			// same as a real terminal would treat an unbound one. Only a bare,
			// unmodified character is native text input.
			if (
				event.key.length === 1 &&
				!event.ctrlKey &&
				!event.altKey &&
				!event.metaKey
			) {
				replaceSelection(input, event.key, start, end);
			}
	}
}

/** Plays an unconsumed plain ArrowUp/ArrowDown back through `prompt-box.tsx`'s
 * own keydown handling (prompt history recall), the same non-bubbling replay
 * Enter uses: that handler stood down for the original event (see
 * `takesPromptKey`) so a listener could see it first. Returns whether history
 * took it. */
function replayHistoryKey(input, event) {
	if (event.key !== "ArrowUp" && event.key !== "ArrowDown") return false;
	if (event.shiftKey || event.ctrlKey || event.metaKey || event.altKey) return false;
	const replay = new KeyboardEvent("keydown", {
		key: event.key,
		code: event.code,
		bubbles: false,
		cancelable: true,
	});
	replaying = true;
	try {
		input.dispatchEvent(replay);
	} finally {
		replaying = false;
	}
	return replay.defaultPrevented;
}

/** Replicates `prompt-box.tsx`'s own inline Escape-blurs-the-prompt handling,
 * for an Escape this module forwarded (and preventDefault()'d) but no
 * `ctx.ui.onTerminalInput` listener consumed. Needed because forwarding a
 * candidate Escape always preventDefault()s it before awaiting the server's
 * answer — see `handlePromptLevelKeydown`'s doc comment — which stands down
 * prompt-box.tsx's own target-phase handler for that same keypress (it never
 * sees `defaultPrevented` false to act on). Same gating prompt-box.tsx's own
 * handler uses, minus the modifier checks `isForwardCandidate` already made
 * (ctrl/meta/alt) — only Shift needs rechecking here, since Escape is a
 * forward candidate regardless of it. */
function blurPromptIfIdle(input, event) {
	if (event.shiftKey) return;
	if (window.piUi.pickers.isOpen()) return;
	if (!document.querySelector("[data-send-trigger]")) return;
	input?.blur();
}

/** Replicates `prompt-action.tsx`'s window-level Escape-aborts-the-run handling,
 * for the same reason `blurPromptIfIdle` exists: the forwarded Escape was
 * preventDefault()'d before that (bubble-phase, `window`) handler saw it, so it
 * stood down. Real interactive-mode behaves the same way — raw
 * `onTerminalInput` listeners see Escape first, and only an unconsumed one
 * reaches `app.interrupt`. Clicks the abort button (only rendered while a turn
 * runs) so the abort goes through its own `@post`. Returns whether it aborted. */
function abortRunIfActive(event) {
	if (event.shiftKey) return false;
	const abort = document.querySelector('#prompt-action[data-variant="destructive"]');
	if (!abort) return false;
	// A fresh event: the original is already defaultPrevented, and only the
	// "is a picker/modal/popover open" half of this check applies here.
	const probe = new KeyboardEvent("keydown", { key: "Escape", cancelable: true });
	if (!window.piUi.shouldAbortOnEscape(probe)) return false;
	abort.click();
	return true;
}

async function forwardToListeners(encoded) {
	try {
		const response = await postJson(endpoints.extensionPromptInput, {
			data: encoded,
		});
		return Boolean((await response.json()).consumed);
	} catch {
		// Best-effort: treat a dropped request as "not consumed", the same as
		// an extension that declined the key.
		return false;
	}
}

/** Whether typed keys are still queued behind a forward round trip. Exposed
 * on `window.piUi.extensionKeys` so `prompt-box.tsx`'s inline Enter-to-send
 * stands down (and lets this module queue the Enter) instead of submitting
 * a prompt the queued keys haven't reached yet. */
export function promptInputBusy() {
	return !replaying && (draining || pendingKeys.length > 0);
}

/** The first active `registerShortcut()` key id `event` matches, if any. */
function matchingShortcutKey(event) {
	return currentShortcutKeys().find((keyId) => matchesKeyId(event, keyId));
}

/** Delivers a forwarded chord no listener consumed to pi-ui's own
 * `window`-level keybinds (Datastar `data-on:keydown__window`), which
 * `handlePromptLevelKeydown` kept it from while the listeners decided. A
 * fresh, non-bubbling event dispatched on `window` itself: the original is
 * already defaultPrevented, and only `window`'s listeners should see it. */
function replayToWindow(event) {
	window.dispatchEvent(
		new KeyboardEvent("keydown", {
			key: event.key,
			code: event.code,
			ctrlKey: event.ctrlKey,
			altKey: event.altKey,
			shiftKey: event.shiftKey,
			metaKey: event.metaKey,
			repeat: event.repeat,
			bubbles: false,
			cancelable: true,
		}),
	);
}

async function processPendingKey({ event, fromPrompt, heldFromWindow }) {
	const input = promptInput();
	const promptEmpty = !input || input.value.length === 0;
	if (promptLevelInputActive() && isForwardCandidate(event, promptEmpty)) {
		const encoded = encodeKeyEvent(event);
		if (encoded !== null && (await forwardToListeners(encoded))) {
			flashCaptureIndicator();
			return;
		}
	}
	// Unconsumed: next in the TUI's order is the editor's `registerShortcut()`
	// check (`handleShortcutKeydown` never saw this key — forwarding took it).
	const shortcutKey = matchingShortcutKey(event);
	if (shortcutKey !== undefined) {
		invokeShortcut(shortcutKey);
		return;
	}
	if (heldFromWindow) replayToWindow(event);
	if (event.key === "Escape") {
		if (!abortRunIfActive(event)) blurPromptIfIdle(input, event);
		return;
	}
	// A key typed with focus on <body> had no native effect to play back.
	if (fromPrompt && input) applyKeyLocally(input, event);
}

async function drainPendingKeys() {
	draining = true;
	try {
		while (pendingKeys.length > 0) {
			const next = pendingKeys.shift();
			if (next) await processPendingKey(next);
		}
	} finally {
		draining = false;
	}
}

/**
 * Prompt-level `onTerminalInput` forwarding (F1 §2). Returns whether it took
 * the key. A forward candidate is preventDefault()'d synchronously and queued;
 * while anything is queued, every ordinary editing key is queued behind it
 * too, so fast typing (two keydowns inside one round trip) is applied in
 * order rather than the later round trip overwriting the earlier key.
 */
/**
 * Whether `handlePromptLevelKeydown` will take this keydown (forward it, or
 * queue it behind a forward in flight). Exposed on `window.piUi.extensionKeys`
 * so `prompt-box.tsx`'s own target-phase ArrowUp/ArrowDown history recall
 * stands down for it: that handler runs on the textarea before this module's
 * `document` listener, and recalling history there first would preventDefault()
 * the arrow before a manage-mode listener (`/bg`, `/subagents`) ever saw it.
 * An unconsumed arrow is replayed into that handler (`replayHistoryKey`).
 */
export function takesPromptKey(event) {
	if (replaying || event.defaultPrevented || event.isComposing) return false;
	if (!focusInScope()) return false;
	const input = promptInput();
	const fromPrompt = input !== undefined && event.target === input;
	if (pendingKeys.length > 0 || draining) return fromPrompt && isOrderedKey(event);
	if (!promptLevelInputActive()) return false;
	const promptEmpty = !input || input.value.length === 0;
	if (!isForwardCandidate(event, promptEmpty)) return false;
	return encodeKeyEvent(event) !== null;
}

function handlePromptLevelKeydown(event) {
	if (!takesPromptKey(event)) return false;
	const input = promptInput();
	const fromPrompt = input !== undefined && event.target === input;
	event.preventDefault();
	// A chord could be one of pi-ui's own `window`-level keybinds: keep it from
	// them until the listeners answer (`replayToWindow`), like the TUI's raw
	// listeners preempting its app keybindings. A chord only gets here as a
	// forward candidate (`isOrderedKey` never queues one behind a forward).
	const heldFromWindow = event.ctrlKey || event.altKey;
	if (heldFromWindow) event.stopPropagation();
	pendingKeys.push({ event, fromPrompt, heldFromWindow });
	if (!draining) void drainPendingKeys();
	return true;
}

function handleShortcutKeydown(event) {
	if (event.defaultPrevented || event.isComposing || !focusInScope()) return;
	const keyId = matchingShortcutKey(event);
	if (keyId === undefined) return;
	event.preventDefault();
	invokeShortcut(keyId);
}

export function bindExtensionKeys() {
	document.addEventListener("keydown", (event) => {
		// Prompt-level `onTerminalInput` forwarding goes first, mirroring the
		// real TUI's raw `inputListeners`, which see every keystroke before any
		// focused-component dispatch (including `registerShortcut`'s own
		// editor-level `onExtensionShortcut` check) — see this module's doc
		// comment. Both decisions are synchronous, so `preventDefault()` always
		// lands while the event is still being dispatched.
		if (handlePromptLevelKeydown(event)) return;
		handleShortcutKeydown(event);
	});
}
