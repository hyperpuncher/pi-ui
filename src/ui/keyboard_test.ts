import { test } from "bun:test";

import { assertEquals, assertStringIncludes } from "#testing/assertions";

import { altShortcutAction, ShortcutKbd } from "./keyboard.tsx";

test("alt shortcuts use physical keys and ignore open dialogs", () => {
	const action = altShortcutAction("KeyF", "focusFiles();");

	assertStringIncludes(action, "evt.code === 'KeyF'");
	assertStringIncludes(action, "evt.altKey");
	assertStringIncludes(action, "!evt.shiftKey");
	assertStringIncludes(action, "!evt.ctrlKey");
	assertStringIncludes(action, "!evt.metaKey");
	assertStringIncludes(action, "!document.querySelector('dialog[open]')");
	assertStringIncludes(action, "focusFiles();");
});

test("shortcut keys use platform-appropriate modifiers", async () => {
	const html = await ShortcutKbd({ shortcut: "alt F" });

	assertStringIncludes(html, "data-keybind-hint");
	assertStringIncludes(html, process.platform === "darwin" ? "⌥" : ">alt</kbd>");
	assertStringIncludes(html, ">F</kbd>");
	assertEquals(html.match(/<kbd/g)?.length, 2);
});
