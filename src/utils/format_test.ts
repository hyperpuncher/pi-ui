import { test } from "bun:test";

import { assertEquals } from "#testing/assertions";

import { formatExtensionName } from "./format.ts";

test("formatExtensionName shortens an extension path to its file or package name", () => {
	assertEquals(
		formatExtensionName(String.raw`C:\Users\me\.pi\agent\extensions\btw.ts`),
		"btw",
	);
	assertEquals(
		formatExtensionName("/home/me/.pi/agent/extensions/plan-mode.js"),
		"plan-mode",
	);
	assertEquals(
		formatExtensionName("/home/me/.pi/agent/extensions/web-access/index.ts"),
		"web-access",
	);
	assertEquals(formatExtensionName("<inline:llama>"), "<inline:llama>");
});
