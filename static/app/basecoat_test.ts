import { assertEquals } from "@std/assert";

import { classifyCommandChange } from "./basecoat.js";

Deno.test("command mutation classification refreshes row-only changes", () => {
	const input = {};
	const menu = {};
	assertEquals(classifyCommandChange({ input, menu }, { input, menu }), "refresh");
});

Deno.test("command mutation classification reinitializes replaced listener owners", () => {
	const input = {};
	const menu = {};
	assertEquals(
		classifyCommandChange({ input, menu }, { input: {}, menu }),
		"reinitialize",
	);
	assertEquals(
		classifyCommandChange({ input, menu }, { input, menu: {} }),
		"reinitialize",
	);
});
