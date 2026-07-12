import { assertEquals } from "@std/assert";

import { completeFileValue, extractFilePrefix } from "./pickers.js";

Deno.test("extractFilePrefix finds the @ token at the caret", () => {
	assertEquals(extractFilePrefix("open @src/ui after", 12), {
		start: 5,
		end: 12,
		query: "src/ui",
	});
	assertEquals(extractFilePrefix("plain text", 10), undefined);
	assertEquals(extractFilePrefix("x=@src", 6), {
		start: 2,
		end: 6,
		query: "src",
	});
});

Deno.test("file completion preserves surrounding prompt text and directory flow", () => {
	const match = { start: 4, end: 7, query: "sr" };
	assertEquals(completeFileValue("see @sr now", match, "src/app.ts"), {
		text: "see @src/app.ts  now",
		cursor: 16,
	});
	assertEquals(completeFileValue("see @sr", match, "src/"), {
		text: "see @src/",
		cursor: 9,
	});
});
