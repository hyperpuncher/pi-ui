import { assertEquals } from "@std/assert";

import denoConfig from "../deno.json" with { type: "json" };
import { isVersionRequest, version } from "./version.ts";

Deno.test("version output uses the package version and only the long flag", () => {
	assertEquals(version, denoConfig.version);
	assertEquals(isVersionRequest(["--version"]), true);
	assertEquals(isVersionRequest(["-V"]), false);
	assertEquals(isVersionRequest(["--version", "--help"]), false);
});
