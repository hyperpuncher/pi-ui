import { test } from "bun:test";

import { fileUriToPath } from "#static/file-uri.js";
import { assertEquals } from "#testing/assertions";

const cases = [
	[
		"spaces and Unicode",
		"file:///home/user/My%20Files/%E2%9C%93.txt",
		"/home/user/My Files/✓.txt",
	],
	[
		"uppercase Windows drive",
		"file:///C:/Users/name/file.txt",
		"C:/Users/name/file.txt",
	],
	[
		"UNC host and share",
		"file://server/share/folder/file.txt",
		"//server/share/folder/file.txt",
	],
	["localhost", "file://localhost/home/user/file.txt", "/home/user/file.txt"],
	["non-file URL", "https://example.com/file.txt", undefined],
	["malformed URL", "not a URL", undefined],
	["malformed percent encoding", "file:///home/user/%ZZ.txt", undefined],
] as const;

for (const [name, uri, expected] of cases) {
	test(name, () => {
		assertEquals(fileUriToPath(uri), expected);
	});
}
