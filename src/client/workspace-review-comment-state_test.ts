import { assertEquals, assertExists } from "@std/assert";

import { createWorkspaceReviewCommentStore } from "./workspace-review-comment-state.ts";

Deno.test("review comment store drafts and batches comments", () => {
	const store = createWorkspaceReviewCommentStore();
	assertEquals(
		store.add("src/app.ts", "version-1", {
			end: 14,
			start: 12,
			side: "additions",
		}),
		true,
	);
	assertEquals(
		store.add("src/other.ts", "version-1", {
			end: 4,
			start: 4,
			side: "deletions",
		}),
		false,
	);

	const first = store.annotations.get("src/app.ts")?.[0];
	assertExists(first);
	assertEquals(store.save(first.metadata.id, "  handle this case  "), "src/app.ts");
	assertEquals(
		store.add("src/other.ts", "version-1", {
			end: 4,
			start: 4,
			side: "deletions",
		}),
		true,
	);
	const second = store.annotations.get("src/other.ts")?.[0];
	assertExists(second);
	assertEquals(store.save(second.metadata.id, "remove this"), "src/other.ts");

	assertEquals(store.savedComments(), [
		{
			body: "handle this case",
			endLine: 14,
			endSide: "additions",
			path: "src/app.ts",
			startLine: 12,
			startSide: "additions",
		},
		{
			body: "remove this",
			endLine: 4,
			endSide: "deletions",
			path: "src/other.ts",
			startLine: 4,
			startSide: "deletions",
		},
	]);
});

Deno.test("review comment store removes comments when their diff changes", () => {
	const store = createWorkspaceReviewCommentStore();
	store.add("src/app.ts", "version-1", {
		end: 14,
		start: 12,
		side: "additions",
	});
	const draft = store.annotations.get("src/app.ts")?.[0];
	assertExists(draft);
	store.save(draft.metadata.id, "handle this case");

	assertEquals(store.reconcileFiles(new Map([["src/app.ts", "version-1"]])), []);
	assertEquals(store.annotations.size, 1);
	assertEquals(store.reconcileFiles(new Map([["src/app.ts", "version-2"]])), [
		"src/app.ts",
	]);
	assertEquals(store.annotations.size, 0);
});
