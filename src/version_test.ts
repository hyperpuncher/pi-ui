import { test } from "bun:test";

import { assertEquals } from "#testing/assertions";

import packageJson from "../package.json" with { type: "json" };
import { isVersionRequest, version } from "./version.ts";

test("version output uses the package version and only the long flag", () => {
	assertEquals(version, packageJson.version);
	assertEquals(isVersionRequest(["--version"]), true);
	assertEquals(isVersionRequest(["-V"]), false);
	assertEquals(isVersionRequest(["--version", "--help"]), false);
});
