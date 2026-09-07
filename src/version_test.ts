import { test } from "bun:test";

import { assertEquals } from "#testing/assertions";

import { isVersionRequest } from "./version.ts";

test("version requests accept only a standalone long flag", () => {
	assertEquals(isVersionRequest(["--version"]), true);
	assertEquals(isVersionRequest(["-V"]), false);
	assertEquals(isVersionRequest(["--version", "--help"]), false);
});
