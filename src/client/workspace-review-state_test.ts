import { assertEquals } from "@std/assert";

import type { WorkspaceCommit, WorkspaceFileChange } from "../workspace-review-types.ts";
import {
	appendHistoryPage,
	reconcileFirstHistoryPage,
	reconcileReviewAvailability,
	reconcileSelection,
	selectionForReviewOpen,
	workspaceReviewLoading,
	workspaceReviewStateChanged,
} from "./workspace-review-state.ts";

function commit(hash: string): WorkspaceCommit {
	return {
		author: "Author",
		authoredAt: "2026-01-01T00:00:00.000Z",
		hash,
		pushed: false,
		shortHash: hash,
		subject: hash,
	};
}

function change(path: string): WorkspaceFileChange {
	return { additions: 1, deletions: 0, path, status: "modified" };
}

Deno.test("summary and unloaded revisions represent loading state", () => {
	assertEquals(workspaceReviewLoading("git-unloaded"), true);
	assertEquals(workspaceReviewLoading("git-summary:abc"), true);
	assertEquals(workspaceReviewLoading("abc"), false);
});

Deno.test("workspace changes reconcile equal Git revisions", () => {
	assertEquals(
		workspaceReviewStateChanged(
			{ revision: "same", workspacePath: "/first" },
			{ revision: "same", workspacePath: "/second" },
		),
		true,
	);
	assertEquals(
		workspaceReviewStateChanged(
			{ revision: "same", workspacePath: "/first" },
			{ revision: "same", workspacePath: "/first" },
		),
		false,
	);
});

Deno.test("loading another workspace preserves Git view availability", () => {
	assertEquals(
		reconcileReviewAvailability(true, {
			isGitRepository: false,
			revision: "git-unloaded",
		}),
		true,
	);
	assertEquals(
		reconcileReviewAvailability(true, {
			isGitRepository: false,
			revision: "non-git",
		}),
		false,
	);
});

Deno.test("same-head refresh preserves unique older commits", () => {
	const firstPage = Array.from({ length: 50 }, (_, index) => commit(`h${index}`));
	const current = [...firstPage, commit("older"), commit("duplicate")];
	const next = [...firstPage.slice(0, 49), commit("duplicate")];
	const result = reconcileFirstHistoryPage(current, true, next);

	assertEquals(result.reset, false);
	assertEquals(result.hasMore, true);
	assertEquals(
		result.commits.map(({ hash }) => hash),
		[...next.map(({ hash }) => hash), "older"],
	);
});

Deno.test("changed head resets history and pagination", () => {
	const next = [commit("new-head")];
	const result = reconcileFirstHistoryPage(
		[commit("old-head"), commit("older")],
		true,
		next,
	);

	assertEquals(result, { commits: next, hasMore: false, reset: true });
	assertEquals(appendHistoryPage(next, [commit("new-head")]), {
		commits: next,
		hasMore: false,
	});
});

Deno.test("opening review prefers working changes over a commit", () => {
	const selectedCommit = { hash: "head", kind: "commit" } as const;
	assertEquals(selectionForReviewOpen(selectedCommit, [change("first.ts")]), {
		kind: "working",
		path: "first.ts",
	});
	assertEquals(selectionForReviewOpen(selectedCommit, []), selectedCommit);
});

Deno.test("snapshot reconciliation chooses an available selection", () => {
	assertEquals(
		reconcileSelection(
			{ kind: "working", path: "removed.ts" },
			false,
			[change("first.ts")],
			[],
		),
		{ kind: "working", path: "first.ts" },
	);
	assertEquals(reconcileSelection({ kind: "working" }, true, [], [commit("head")]), {
		hash: "head",
		kind: "commit",
	});
});
