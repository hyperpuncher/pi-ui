import { assertEquals } from "@std/assert";

import { fuzzyFilter, fuzzyMatch } from "./pi-fuzzy.ts";

Deno.test("pi fuzzy matching filters and ranks slash command names", () => {
	assertEquals(fuzzyMatch("lg", "login").matches, true);
	assertEquals(fuzzyMatch("lg", "tree").matches, false);
	assertEquals(
		fuzzyFilter(["compact", "share", "login", "skill:review"], "s", (name) => name),
		["share", "skill:review"],
	);
	assertEquals(
		fuzzyFilter(["clone", "cl"], "cl", (name) => name),
		["cl", "clone"],
	);
});
