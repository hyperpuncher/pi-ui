import { test } from "bun:test";

import {
	ariaKeyshortcuts,
	canonicalShortcut,
	hasPrimaryModifier,
	parseShortcut,
	shortcutMatchExpression,
} from "#src/utils/keyboard.ts";
import { assertEquals } from "#testing/assertions";

const modifiers = (ctrlKey: boolean, metaKey: boolean) => ({ ctrlKey, metaKey });

test("primary modifier uses command exclusively on macOS", () => {
	assertEquals(hasPrimaryModifier(modifiers(false, true), "darwin"), true);
	assertEquals(hasPrimaryModifier(modifiers(true, false), "darwin"), false);
	assertEquals(hasPrimaryModifier(modifiers(true, true), "darwin"), false);
});

test("primary modifier uses control exclusively outside macOS", () => {
	assertEquals(hasPrimaryModifier(modifiers(true, false), "linux"), true);
	assertEquals(hasPrimaryModifier(modifiers(false, true), "linux"), false);
	assertEquals(hasPrimaryModifier(modifiers(true, true), "linux"), false);
});

test("shortcut parser canonicalizes modifier order and casing", () => {
	const spec = parseShortcut("ALT control o");
	assertEquals(spec && canonicalShortcut(spec), "ctrl alt O");
});

test("shortcut parser rejects malformed chords", () => {
	assertEquals(parseShortcut(""), undefined);
	assertEquals(parseShortcut("ctrl"), undefined);
	assertEquals(parseShortcut("ctrl K L"), undefined);
	assertEquals(parseShortcut("ctrl K alt"), undefined);
	assertEquals(parseShortcut("ctrl ctrl K"), undefined);
	assertEquals(parseShortcut("meta K"), undefined);
});

test("generated shortcuts match physical keys and reject extra modifiers on both platforms", () => {
	for (const platform of ["linux", "darwin"] as const) {
		const match = new Function(
			"evt",
			`return !!(${shortcutMatchExpression(parseShortcut("ctrl alt O")!, "evt", platform)});`,
		);
		const primary = platform === "darwin" ? { metaKey: true } : { ctrlKey: true };
		assertEquals(match({ ...primary, altKey: true, code: "KeyO" }), true);
		assertEquals(match({ ...primary, altKey: true, code: "KeyP" }), false);
		assertEquals(match({ ...primary, code: "KeyO" }), false);
		assertEquals(
			match({ ...primary, altKey: true, shiftKey: true, code: "KeyO" }),
			false,
		);
		assertEquals(
			match({ ctrlKey: true, metaKey: true, altKey: true, code: "KeyO" }),
			false,
		);
	}
});

test("non-primary shortcuts reject control and command", () => {
	const match = new Function(
		"evt",
		`return !!(${shortcutMatchExpression(parseShortcut("alt F")!, "evt")});`,
	);
	assertEquals(match({ altKey: true, code: "KeyF" }), true);
	assertEquals(match({ altKey: true, ctrlKey: true, code: "KeyF" }), false);
	assertEquals(match({ altKey: true, metaKey: true, code: "KeyF" }), false);
});

test("symbolic shortcuts accept the shift needed to type the symbol", () => {
	const match = new Function(
		"evt",
		`return !!(${shortcutMatchExpression(parseShortcut("ctrl ^")!, "evt", "darwin")});`,
	);
	assertEquals(match({ metaKey: true, shiftKey: true, key: "^" }), true);
	assertEquals(match({ metaKey: true, shiftKey: true, key: "6" }), false);
	assertEquals(match({ ctrlKey: true, shiftKey: true, key: "^" }), false);
});

test("aria-keyshortcuts lists control and meta variants for primary chords", () => {
	assertEquals(
		ariaKeyshortcuts(parseShortcut("ctrl alt O")!),
		"Control+Alt+O Meta+Alt+O",
	);
	assertEquals(ariaKeyshortcuts(parseShortcut("alt shift T")!), "Alt+Shift+T");
	assertEquals(ariaKeyshortcuts(parseShortcut("ctrl /")!), "Control+/ Meta+/");
});
