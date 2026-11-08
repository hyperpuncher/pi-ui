import { expect, test } from "bun:test";

import { compactToolOutput } from "#src/agent/tool-presentation.ts";

test.each([
	{ name: "empty output", input: "", expected: "" },
	{ name: "whitespace-only output", input: " \t\r\n", expected: "" },
	{
		name: "short output with blank lines and unicode",
		input: "first\n\nλ 😀\u2028last \r\n\t",
		expected: "first\n\nλ 😀\u2028last",
	},
	{
		name: "seven lines without compaction",
		input: "1\n2\n3\n4\n5\n6\n7\n",
		expected: "1\n2\n3\n4\n5\n6\n7",
	},
	{
		name: "eight lines with blank lines and CRLF",
		input: "1\r\n2\r\n3\r\n4\r\n\r\nλ 😀\r\n\r\nlast \r\n\t",
		expected: "... (4 earlier lines)\n\r\nλ 😀\r\n\r\nlast",
	},
])("tool previews preserve $name", ({ input, expected }) => {
	expect(compactToolOutput(input)).toBe(expected);
});
