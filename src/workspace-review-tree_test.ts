import { assertEquals } from "@std/assert";

import { sortWorkspaceReviewEntries } from "./workspace-review-tree.ts";

Deno.test("workspace review paths follow file tree order", () => {
	assertEquals(
		sortPaths(["README.md", "src/file10.ts", ".env", "src/file2.ts", "docs/a.ts"]),
		["docs/a.ts", "src/file2.ts", "src/file10.ts", ".env", "README.md"],
	);
});

Deno.test("workspace review tree order handles test file names", () => {
	assertEquals(
		sortPaths([
			"src/server/workspace-review_test.ts",
			"src/client/workspace-review-state_test.ts",
			"README.md",
			"src/server/workspace-review.ts",
			"src/client/workspace-review-state.ts",
		]),
		[
			"src/client/workspace-review-state.ts",
			"src/client/workspace-review-state_test.ts",
			"src/server/workspace-review.ts",
			"src/server/workspace-review_test.ts",
			"README.md",
		],
	);
});

function sortPaths(paths: readonly string[]): string[] {
	return sortWorkspaceReviewEntries(paths.map((path) => ({ path }))).map(
		({ path }) => path,
	);
}
