import { assertEquals } from "@std/assert";

import { normalizeWorkspaceReviewPreferences } from "../workspace-review-types.ts";
import {
	readWorkspaceReviewPreferences,
	writeWorkspaceReviewPreferences,
} from "./workspace-review-preferences.ts";

Deno.test("workspace review preference defaults remain undefined", () => {
	assertEquals(normalizeWorkspaceReviewPreferences(undefined), {});
	assertEquals(normalizeWorkspaceReviewPreferences({}), {
		changesRatio: undefined,
		gitPaneRatio: undefined,
		layout: undefined,
		mode: undefined,
		reviewSidebarWidth: undefined,
		wrap: undefined,
	});
});

Deno.test("workspace review preferences validate layout values", () => {
	assertEquals(
		normalizeWorkspaceReviewPreferences({
			changesRatio: 0.4,
			gitPaneRatio: 0.6,
			layout: "unified",
			mode: "selected",
			reviewSidebarWidth: 320,
			wrap: false,
		}),
		{
			changesRatio: 0.4,
			gitPaneRatio: 0.6,
			layout: "unified",
			mode: "selected",
			reviewSidebarWidth: 320,
			wrap: false,
		},
	);
	assertEquals(
		normalizeWorkspaceReviewPreferences({
			changesRatio: Number.NaN,
			gitPaneRatio: "0.5",
			reviewSidebarWidth: Number.POSITIVE_INFINITY,
		}),
		{
			changesRatio: undefined,
			gitPaneRatio: undefined,
			layout: undefined,
			mode: undefined,
			reviewSidebarWidth: undefined,
			wrap: undefined,
		},
	);
	assertEquals(
		normalizeWorkspaceReviewPreferences({
			changesRatio: -1,
			gitPaneRatio: 2,
			reviewSidebarWidth: 999,
		}),
		{
			changesRatio: 0.3,
			gitPaneRatio: 0.65,
			layout: undefined,
			mode: undefined,
			reviewSidebarWidth: 480,
			wrap: undefined,
		},
	);
});

Deno.test("workspace review preferences persist without replacing future config", async () => {
	const directory = await Deno.makeTempDir();
	const path = `${directory}/nested/preferences.json`;
	try {
		assertEquals(await readWorkspaceReviewPreferences(path), {});
		await Deno.mkdir(`${directory}/nested`);
		await Deno.writeTextFile(path, '{"futureSetting":true}\n');
		const preferences = {
			changesRatio: 0.4,
			gitPaneRatio: 0.6,
			layout: "unified" as const,
			mode: "selected" as const,
			reviewSidebarWidth: 320,
			wrap: false,
		};
		await writeWorkspaceReviewPreferences(preferences, path);
		assertEquals(await readWorkspaceReviewPreferences(path), preferences);
		assertEquals(JSON.parse(await Deno.readTextFile(path)), {
			futureSetting: true,
			gitView: preferences,
		});
	} finally {
		await Deno.remove(directory, { recursive: true });
	}
});
