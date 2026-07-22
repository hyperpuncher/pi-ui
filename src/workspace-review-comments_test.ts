import { assertEquals, assertThrows } from "@std/assert";

import {
	formatWorkspaceReviewPrompt,
	parseWorkspaceReviewComments,
} from "./workspace-review-comments.ts";

Deno.test("review comment parsing validates and trims client input", () => {
	assertEquals(
		parseWorkspaceReviewComments({
			comments: [
				{
					body: "  update this  ",
					endLine: 9,
					endSide: "additions",
					path: "src/app.ts",
					startLine: 7,
					startSide: "deletions",
				},
			],
		}),
		[
			{
				body: "update this",
				endLine: 9,
				endSide: "additions",
				path: "src/app.ts",
				startLine: 7,
				startSide: "deletions",
			},
		],
	);
	assertThrows(() => parseWorkspaceReviewComments({ comments: [] }));
	assertThrows(() =>
		parseWorkspaceReviewComments({
			comments: [
				{
					body: "comment",
					endLine: 1,
					endSide: "additions",
					path: "bad\npath",
					startLine: 1,
					startSide: "additions",
				},
			],
		}),
	);
});

Deno.test("review comment parsing rejects an oversized batch", () => {
	assertThrows(() =>
		parseWorkspaceReviewComments({
			comments: Array.from({ length: 11 }, () => ({
				body: "x".repeat(20_000),
				endLine: 1,
				endSide: "additions",
				path: "src/app.ts",
				startLine: 1,
				startSide: "additions",
			})),
		}),
	);
});

Deno.test("review comments format as a concise agent prompt", () => {
	const prompt = formatWorkspaceReviewPrompt([
		{
			body: "another one!",
			endLine: 159,
			endSide: "additions",
			path: "src/server/routes/routes_integration_test.ts",
			startLine: 153,
			startSide: "additions",
		},
		{
			body: "slop",
			endLine: 139,
			endSide: "additions",
			path: "src/server/routes/routes_integration_test.ts",
			startLine: 130,
			startSide: "additions",
		},
	]);
	assertEquals(
		prompt,
		"address the following review comments:\n\n" +
			"1. src/server/routes/routes_integration_test.ts:153–159\n" +
			"another one!\n\n" +
			"2. src/server/routes/routes_integration_test.ts:130–139\n" +
			"slop",
	);
});
