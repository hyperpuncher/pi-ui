import { test } from "bun:test";

import { assertEquals } from "#testing/assertions";

import { fileUriToPath, isHtmlFileUri } from "./file-uri.js";

test("HTML file links render only html and htm paths, ignoring query and fragment", () => {
	for (const uri of [
		"file:///tmp/report.html",
		"file:///tmp/My%20report.HTM?mode=dark#chart",
		"file:///tmp/report%2Ehtml",
	])
		assertEquals(isHtmlFileUri(uri), true);
	for (const uri of [
		"file:///tmp/report.ts#html",
		"file:///tmp/report.html.txt",
		"https://example.com/report.html",
		"file:///tmp/%ZZ.html",
	])
		assertEquals(isHtmlFileUri(uri), false);
});

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
	test(name, () => {
		assertEquals(fileUriToPath(uri), expected);
	});
}
