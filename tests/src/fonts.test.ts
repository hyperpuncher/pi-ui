import { test } from "bun:test";

import { defaultFonts, validFonts } from "#src/fonts.ts";
import { assertEquals } from "#testing/assertions";

test("font preferences validate known interface and code fonts", () => {
	assertEquals(validFonts({ mono: "JetBrains Mono", sans: "Inter" }), {
		mono: "JetBrains Mono",
		sans: "Inter",
	});
	assertEquals(validFonts({ mono: "missing", sans: "system" }), undefined);
	assertEquals(defaultFonts(), { mono: "system", sans: "system" });
});
