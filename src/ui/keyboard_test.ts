import { test } from "bun:test";

import { assertEquals, assertStringIncludes } from "#testing/assertions";

import { altShortcutAction, ShortcutKbd } from "./keyboard.tsx";

test("alt shortcuts use physical keys and ignore open dialogs", () => {
	const run = new Function(
		"evt",
		"document",
		"focusFiles",
		altShortcutAction("KeyF", "focusFiles();"),
	);
	for (const scenario of [
		{ key: "f", code: "KeyF", altKey: true, allowed: true },
		{ key: "ƒ", code: "KeyF", altKey: true, allowed: true },
		{ key: "f", code: "KeyG", altKey: true, allowed: false },
		{ code: "KeyF", altKey: false, allowed: false },
		{ code: "KeyF", altKey: true, shiftKey: true, allowed: false },
		{ code: "KeyF", altKey: true, ctrlKey: true, allowed: false },
		{ code: "KeyF", altKey: true, metaKey: true, allowed: false },
		{ code: "KeyF", altKey: true, dialogOpen: true, allowed: false },
	]) {
		let focused = 0;
		let prevented = 0;
		run(
			{ ...scenario, preventDefault: () => prevented++ },
			{
				querySelector: (selector: string) =>
					selector === "dialog[open]" && scenario.dialogOpen ? {} : null,
			},
			() => focused++,
		);
		assertEquals(focused, scenario.allowed ? 1 : 0);
		assertEquals(prevented, scenario.allowed ? 1 : 0);
	}
});

test("shortcut keys use platform-appropriate modifiers", async () => {
	const html = await ShortcutKbd({ shortcut: "alt F" });

	assertStringIncludes(html, "data-keybind-hint");
	assertStringIncludes(html, process.platform === "darwin" ? "⌥" : ">alt</kbd>");
	assertStringIncludes(html, ">F</kbd>");
	assertEquals(html.match(/<kbd/g)?.length, 2);
});
