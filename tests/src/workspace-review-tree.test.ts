import { test } from "bun:test";

import { sortWorkspaceReviewEntries } from "#src/workspace-review-tree.ts";
import { assertEquals } from "#testing/assertions";

test("workspace review paths follow file tree order", () => {
	assertEquals(
		sortPaths(["README.md", "src/file10.ts", ".env", "src/file2.ts", "docs/a.ts"]),
		["docs/a.ts", "src/file2.ts", "src/file10.ts", ".env", "README.md"],
	);
});

test("workspace review tree order handles test file names", () => {
	assertEquals(
		sortPaths([
			"tests/src/server/workspace-review.test.ts",
			"tests/src/client/workspace-review-state.test.ts",
			"README.md",
			"src/server/workspace-review.ts",
			"src/client/workspace-review-state.ts",
		]),
		[
			"src/client/workspace-review-state.ts",
			"src/server/workspace-review.ts",
			"tests/src/client/workspace-review-state.test.ts",
			"tests/src/server/workspace-review.test.ts",
			"README.md",
		],
	);
});

function sortPaths(paths: readonly string[]): string[] {
	return sortWorkspaceReviewEntries(paths.map((path) => ({ path }))).map(
		({ path }) => path,
	);
}
