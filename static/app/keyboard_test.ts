import { assertEquals } from "@std/assert";

import { isComposing } from "./keyboard.js";

Deno.test("composition is detected from the standard flag", () => {
	assertEquals(isComposing({ isComposing: true, keyCode: 13 }), true);
});

Deno.test("composition uses key code 229 as a webkit fallback", () => {
	assertEquals(isComposing({ isComposing: false, keyCode: 229 }), true);
});

Deno.test("ordinary enter is not composition", () => {
	assertEquals(isComposing({ isComposing: false, keyCode: 13 }), false);
});
