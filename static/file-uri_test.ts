import { assertEquals } from "jsr:@std/assert";

import { fileUriToPath } from "./file-uri.js";

const cases = [
	["POSIX path", "file:///home/user/file.txt", "/home/user/file.txt"],
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
	["lowercase Windows drive", "file:///d:/work/file.txt", "d:/work/file.txt"],
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
	Deno.test(name, () => {
		assertEquals(fileUriToPath(uri), expected);
	});
}
