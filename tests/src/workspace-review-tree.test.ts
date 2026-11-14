import { test } from "bun:test";

import { sortWorkspaceReviewEntries } from "#src/workspace-review-tree.ts";
import { assertEquals } from "#testing/assertions";

test("workspace review paths follow file tree order", () => {
	assertEquals(
		sortPaths(["README.md", "src/file10.ts", ".env", "src/file2.ts", "docs/a.ts"]),
		["docs/a.ts", "src/file2.ts", "src/file10.ts", ".env", "README.md"],
	);
});

function sortPaths(paths: readonly string[]): string[] {
	return sortWorkspaceReviewEntries(paths.map((path) => ({ path }))).map(
		({ path }) => path,
	);
}
