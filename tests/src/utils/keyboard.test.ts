import { test } from "bun:test";

import {
	ariaKeyshortcuts,
	canonicalShortcut,
	hasPrimaryModifier,
	parseShortcut,
	primaryModifierExpression,
	shortcutMatchExpression,
} from "#src/utils/keyboard.ts";
import { assertEquals } from "#testing/assertions";

const modifiers = (ctrlKey: boolean, metaKey: boolean) => ({ ctrlKey, metaKey });

test("primary modifier uses command exclusively on macOS", () => {
	assertEquals(hasPrimaryModifier(modifiers(false, true), "darwin"), true);
	assertEquals(hasPrimaryModifier(modifiers(true, false), "darwin"), false);
	assertEquals(hasPrimaryModifier(modifiers(true, true), "darwin"), false);
	assertEquals(
		primaryModifierExpression("event", "darwin"),
		"event.metaKey && !event.ctrlKey",
	);
});

test("primary modifier uses control exclusively outside macOS", () => {
	assertEquals(hasPrimaryModifier(modifiers(true, false), "linux"), true);
	assertEquals(hasPrimaryModifier(modifiers(false, true), "linux"), false);
	assertEquals(hasPrimaryModifier(modifiers(true, true), "linux"), false);
	assertEquals(
		primaryModifierExpression("event", "linux"),
		"event.ctrlKey && !event.metaKey",
	);
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

test("shortcut matcher requires exact modifiers and a physical code", () => {
	const spec = parseShortcut("ctrl alt O");
	assertEquals(
		spec && shortcutMatchExpression(spec, "evt", "linux"),
		"evt.ctrlKey && !evt.metaKey && evt.altKey && !evt.shiftKey && evt.code === 'KeyO'",
	);
	assertEquals(
		spec && shortcutMatchExpression(spec, "evt", "darwin"),
		"evt.metaKey && !evt.ctrlKey && evt.altKey && !evt.shiftKey && evt.code === 'KeyO'",
	);
});

test("non-primary shortcuts exclude both primary modifiers", () => {
	const spec = parseShortcut("alt F");
	assertEquals(
		spec && shortcutMatchExpression(spec, "evt"),
		"!evt.ctrlKey && !evt.metaKey && evt.altKey && !evt.shiftKey && evt.code === 'KeyF'",
	);
});

test("symbolic shortcuts skip the implicit shift constraint", () => {
	const spec = parseShortcut("ctrl ^");
	assertEquals(
		spec && shortcutMatchExpression(spec, "evt", "darwin"),
		"evt.metaKey && !evt.ctrlKey && !evt.altKey && evt.key === '^'",
	);
});

test("aria-keyshortcuts lists control and meta variants for primary chords", () => {
	assertEquals(
		ariaKeyshortcuts(parseShortcut("ctrl alt O")!),
		"Control+Alt+O Meta+Alt+O",
	);
	assertEquals(ariaKeyshortcuts(parseShortcut("alt shift T")!), "Alt+Shift+T");
	assertEquals(ariaKeyshortcuts(parseShortcut("ctrl /")!), "Control+/ Meta+/");
});
