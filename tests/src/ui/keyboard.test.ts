import { test } from "bun:test";

import { ShortcutKbd } from "#src/ui/keyboard.tsx";
import { assertEquals, assertStringIncludes } from "#testing/assertions";

test("shortcut keys use platform-appropriate modifiers", async () => {
	const html = await ShortcutKbd({ shortcut: "alt F" });

	assertStringIncludes(html, "data-keybind-hint");
	assertStringIncludes(html, process.platform === "darwin" ? "⌥" : ">alt</kbd>");
	assertStringIncludes(html, ">F</kbd>");
	assertEquals(html.match(/<kbd/g)?.length, 2);
});
