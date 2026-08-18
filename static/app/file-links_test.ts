import { assertEquals } from "@std/assert";

import { isFileUri } from "./file-links.js";

Deno.test("file link detection accepts only file URIs", () => {
	assertEquals(isFileUri("file:///home/user/report.html"), true);
	assertEquals(isFileUri("file://server/share/report.html"), true);
	assertEquals(isFileUri("https://example.com/report.html"), false);
	assertEquals(isFileUri("/home/user/report.html"), false);
	assertEquals(isFileUri("not a URI"), false);
});
