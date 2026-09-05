import { test } from "bun:test";

import { CombinedAutocompleteProvider } from "@earendil-works/pi-tui";

import { assertEquals } from "#testing/assertions";

import { completeFileValue, extractFilePrefix, nextPickerIndex } from "./pickers.js";

test("extractFilePrefix finds the @ token at the caret", () => {
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

test("quoted file completions follow pi's spacing and cursor behavior", () => {
	const provider = new CombinedAutocompleteProvider([], "/workspace");
	for (const { before, after, value, label } of [
		{ before: "see @sp", after: "", value: '@"space dir/"', label: "space dir/" },
		{
			before: 'see @"space dir/sp',
			after: '" after',
			value: '@"space dir/space file.txt"',
			label: "space file.txt",
		},
		{
			before: 'see @"space dir/ne',
			after: '"',
			value: '@"space dir/nested dir/"',
			label: "nested dir/",
		},
	]) {
		const input = before + after;
		const match = extractFilePrefix(input, before.length);
		if (!match) throw new Error("Missing quoted file prefix");
		const expected = provider.applyCompletion(
			[input],
			0,
			before.length,
			{ value, label },
			`@${match.query}`,
		);
		const actual = completeFileValue(input, match, value);
		assertEquals(actual, { text: expected.lines[0], cursor: expected.cursorCol });
		if (label.endsWith("/")) {
			assertEquals(
				extractFilePrefix(actual.text, actual.cursor)?.query,
				value.slice(1, -1),
			);
		}
	}
});

test("picker navigation stops at both visual boundaries", () => {
	assertEquals(nextPickerIndex(4, -1, -1), 0);
	assertEquals(nextPickerIndex(4, 0, 1), 0);
	assertEquals(nextPickerIndex(4, 3, -1), 3);
	assertEquals(nextPickerIndex(4, 0, -1), 1);
	assertEquals(nextPickerIndex(4, 1, -1), 2);
	assertEquals(nextPickerIndex(4, 1, 1), 0);
});

test("file completion preserves surrounding prompt text and directory flow", () => {
	const match = { start: 4, end: 7, query: "sr" };
	assertEquals(completeFileValue("see @sr now", match, "@src/app.ts"), {
		text: "see @src/app.ts  now",
		cursor: 16,
	});
	assertEquals(completeFileValue("see @sr", match, "@src/"), {
		text: "see @src/",
		cursor: 9,
	});
});
