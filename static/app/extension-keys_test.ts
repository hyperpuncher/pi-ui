import { test } from "bun:test";

import { assertEquals } from "#testing/assertions";

import { isForwardCandidate, matchesKeyId } from "./extension-keys.js";

function key(
	value: string,
	modifiers: Partial<{
		ctrlKey: boolean;
		altKey: boolean;
		shiftKey: boolean;
		metaKey: boolean;
		isComposing: boolean;
	}> = {},
) {
	return {
		key: value,
		ctrlKey: false,
		altKey: false,
		shiftKey: false,
		metaKey: false,
		isComposing: false,
		...modifiers,
	};
}

test("matchesKeyId requires every named modifier held and every unnamed one released", () => {
	assertEquals(matchesKeyId(key("o", { altKey: true }), "alt+o"), true);
	// Case-insensitive base-letter match: pi-tui KeyIds are always lowercase.
	assertEquals(matchesKeyId(key("O", { altKey: true }), "alt+o"), true);
	// An unqualified base never matches a modified chord, and vice versa.
	assertEquals(matchesKeyId(key("o"), "alt+o"), false);
	assertEquals(matchesKeyId(key("o", { altKey: true, ctrlKey: true }), "alt+o"), false);
	assertEquals(
		matchesKeyId(key("x", { ctrlKey: true, shiftKey: true }), "ctrl+shift+x"),
		true,
	);
});

test("matchesKeyId matches special-key tokens against their aliased event.key form", () => {
	assertEquals(matchesKeyId(key("Escape"), "escape"), true);
	assertEquals(matchesKeyId(key("Escape"), "esc"), true);
	assertEquals(matchesKeyId(key("ArrowUp", { altKey: true }), "alt+up"), true);
	assertEquals(matchesKeyId(key("Enter", { ctrlKey: true }), "ctrl+enter"), true);
	// A special-key token never matches an unrelated event.key.
	assertEquals(matchesKeyId(key("Tab"), "escape"), false);
});

test("matchesKeyId matches super (meta) and rejects a literal single-char token typo", () => {
	assertEquals(matchesKeyId(key("k", { metaKey: true }), "super+k"), true);
	assertEquals(matchesKeyId(key("k"), "super+k"), false);
	// A two-plus-char unrecognized token (not in the alias table, length !== 1) never matches.
	assertEquals(matchesKeyId(key("z"), "bogus"), false);
});

test("isForwardCandidate always forwards Escape regardless of prompt contents", () => {
	assertEquals(isForwardCandidate(key("Escape"), false), true);
	assertEquals(isForwardCandidate(key("Escape"), true), true);
});

test("isForwardCandidate forwards an Alt or Ctrl chord regardless of prompt contents", () => {
	// Round 6 F1: Alt+O must reach a hidden workflow view's `onTerminalInput`
	// listener from the prompt, whether or not the prompt has text in it.
	assertEquals(isForwardCandidate(key("o", { altKey: true }), true), true);
	assertEquals(isForwardCandidate(key("o", { altKey: true }), false), true);
	assertEquals(isForwardCandidate(key("m", { ctrlKey: true }), true), true);
	assertEquals(
		isForwardCandidate(key("M", { ctrlKey: true, shiftKey: true }), false),
		true,
	);
});

test("isForwardCandidate never intercepts modified navigation or editing keys", () => {
	// Ctrl+Arrow word jumps, Ctrl+Home/End, Ctrl+Shift+Arrow word selection,
	// Ctrl+Delete, macOS Alt+Arrow/Alt+Backspace: native textarea behavior that
	// an unconsumed forward could not replay.
	for (const name of [
		"ArrowLeft",
		"ArrowRight",
		"ArrowUp",
		"ArrowDown",
		"Home",
		"End",
	]) {
		for (const promptEmpty of [true, false]) {
			assertEquals(
				isForwardCandidate(key(name, { ctrlKey: true }), promptEmpty),
				false,
			);
			assertEquals(
				isForwardCandidate(
					key(name, { ctrlKey: true, shiftKey: true }),
					promptEmpty,
				),
				false,
			);
			assertEquals(
				isForwardCandidate(key(name, { altKey: true }), promptEmpty),
				false,
			);
		}
	}
	assertEquals(isForwardCandidate(key("Delete", { ctrlKey: true }), false), false);
	assertEquals(isForwardCandidate(key("Backspace", { altKey: true }), false), false);
	assertEquals(isForwardCandidate(key("Enter", { ctrlKey: true }), false), false);
	assertEquals(isForwardCandidate(key("Tab", { ctrlKey: true }), false), false);
});

test("isForwardCandidate leaves the browser's own Ctrl chords and macOS Option text alone", () => {
	for (const base of ["f", "g", "p", "s", "r", "l", "k", "=", "-", "0"]) {
		assertEquals(isForwardCandidate(key(base, { ctrlKey: true }), false), false);
	}
	// Devtools (Ctrl+Shift+I/J) is the same base key with Shift held.
	assertEquals(
		isForwardCandidate(key("I", { ctrlKey: true, shiftKey: true }), false),
		false,
	);
	// Option+O on macOS types "ø": text input, not a chord.
	assertEquals(isForwardCandidate(key("ø", { altKey: true }), false), false);
	assertEquals(isForwardCandidate(key("Dead", { altKey: true }), false), false);
});

test("isForwardCandidate rejects Cmd/Meta chords and a bare modifier keydown", () => {
	assertEquals(isForwardCandidate(key("a", { metaKey: true }), true), false);
	assertEquals(isForwardCandidate(key("Alt", { altKey: true }), true), false);
	assertEquals(isForwardCandidate(key("Control", { ctrlKey: true }), true), false);
});

test("isForwardCandidate never intercepts the platform's own editing chords", () => {
	for (const letter of ["c", "v", "x", "a", "z", "y"]) {
		assertEquals(isForwardCandidate(key(letter, { ctrlKey: true }), true), false);
	}
	assertEquals(isForwardCandidate(key("Backspace", { ctrlKey: true }), true), false);
	// Ctrl+Alt+C is a distinct, unclaimed chord — only the Ctrl-only form is protected.
	assertEquals(
		isForwardCandidate(key("c", { ctrlKey: true, altKey: true }), true),
		true,
	);
});

test("isForwardCandidate never intercepts IME composition or AltGraph", () => {
	assertEquals(
		isForwardCandidate(key("o", { altKey: true, isComposing: true }), true),
		false,
	);
	assertEquals(
		isForwardCandidate(
			{ ...key("e", { altKey: true }), getModifierState: () => true },
			true,
		),
		false,
	);
});

test("isForwardCandidate only forwards arrows and single characters while the prompt is empty", () => {
	assertEquals(isForwardCandidate(key("ArrowLeft"), true), true);
	assertEquals(isForwardCandidate(key("ArrowLeft"), false), false);
	assertEquals(isForwardCandidate(key("a"), true), true);
	assertEquals(isForwardCandidate(key("a"), false), false);
	// Multi-character non-special keys (e.g. "Shift", "F5") never forward.
	assertEquals(isForwardCandidate(key("F5"), true), false);
	assertEquals(isForwardCandidate(key("Shift"), true), false);
});
