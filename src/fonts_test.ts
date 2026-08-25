import { assertEquals } from "@std/assert";

import { defaultFonts, validFonts } from "./fonts.ts";

Deno.test("font preferences validate known interface and code fonts", () => {
	assertEquals(validFonts({ mono: "JetBrains Mono", sans: "Inter" }), {
		mono: "JetBrains Mono",
		sans: "Inter",
	});
	assertEquals(validFonts({ mono: "missing", sans: "system" }), undefined);
	assertEquals(defaultFonts(), { mono: "system", sans: "system" });
});
