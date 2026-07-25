import { assertEquals } from "@std/assert";

import { hasPrimaryModifier, primaryModifierExpression } from "./keyboard.ts";

const modifiers = (ctrlKey: boolean, metaKey: boolean) => ({ ctrlKey, metaKey });

Deno.test("primary modifier uses command exclusively on macOS", () => {
	assertEquals(hasPrimaryModifier(modifiers(false, true), "darwin"), true);
	assertEquals(hasPrimaryModifier(modifiers(true, false), "darwin"), false);
	assertEquals(hasPrimaryModifier(modifiers(true, true), "darwin"), false);
	assertEquals(
		primaryModifierExpression("event", "darwin"),
		"event.metaKey && !event.ctrlKey",
	);
});

Deno.test("primary modifier uses control exclusively outside macOS", () => {
	assertEquals(hasPrimaryModifier(modifiers(true, false), "linux"), true);
	assertEquals(hasPrimaryModifier(modifiers(false, true), "linux"), false);
	assertEquals(hasPrimaryModifier(modifiers(true, true), "linux"), false);
	assertEquals(
		primaryModifierExpression("event", "linux"),
		"event.ctrlKey && !event.metaKey",
	);
});
