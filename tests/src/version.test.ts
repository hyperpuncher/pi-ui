import { test } from "bun:test";

import { isVersionRequest } from "#src/version.ts";
import { assertEquals } from "#testing/assertions";

test("version requests accept only a standalone long flag", () => {
	assertEquals(isVersionRequest(["--version"]), true);
	assertEquals(isVersionRequest(["-V"]), false);
	assertEquals(isVersionRequest(["--version", "--help"]), false);
});
