import { test } from "bun:test";

import { assertEquals } from "#testing/assertions";

import {
	hasTrackedWorkspaceChanges,
	normalizeWorkspaceReviewPreferences,
	type WorkspaceFileStatus,
} from "./workspace-review-types.ts";

test("workspace review line totals are known when tracked changes exist", () => {
	const change = (status: WorkspaceFileStatus) => ({
		additions: 0,
		deletions: 0,
		path: `${status}.txt`,
		status,
	});
	assertEquals(hasTrackedWorkspaceChanges([change("untracked")]), false);
	assertEquals(
		hasTrackedWorkspaceChanges([change("untracked"), change("modified")]),
		true,
	);
});

test("workspace review preferences default to empty", () => {
	assertEquals(normalizeWorkspaceReviewPreferences(undefined), {});
});

test("workspace review preferences validate layout values", () => {
	assertEquals(
		normalizeWorkspaceReviewPreferences({
			changesRatio: 0.4,
			gitPaneRatio: 0.6,
			layout: "unified",
			mode: "selected",
			reviewSidebarWidth: 320,
			tab: "git",
			wrap: false,
		}),
		{
			changesRatio: 0.4,
			gitPaneRatio: 0.6,
			layout: "unified",
			mode: "selected",
			reviewSidebarWidth: 320,
			tab: "git",
			wrap: false,
		},
	);
	assertEquals(
		JSON.stringify(
			normalizeWorkspaceReviewPreferences({
				changesRatio: Number.NaN,
				gitPaneRatio: "0.5",
				reviewSidebarWidth: Number.POSITIVE_INFINITY,
			}),
		),
		"{}",
	);
	assertEquals(
		JSON.parse(
			JSON.stringify(
				normalizeWorkspaceReviewPreferences({
					changesRatio: -1,
					gitPaneRatio: 2,
					reviewSidebarWidth: 999,
				}),
			),
		),
		{ changesRatio: 0.3, gitPaneRatio: 0.65, reviewSidebarWidth: 480 },
	);
});
