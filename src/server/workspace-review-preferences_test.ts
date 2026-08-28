import { test } from "bun:test";

import { assertEquals } from "#testing/assertions";
import { mkdir, readTextFile, remove, writeTextFile } from "#testing/files";
import { makeTempDir } from "#testing/temp";

import { appConfigSchemaUrl } from "../config-schema.ts";
import { normalizeWorkspaceReviewPreferences } from "../workspace-review-types.ts";
import {
	readWorkspaceReviewPreferences,
	writeWorkspaceReviewPreferences,
} from "./workspace-review-preferences.ts";

test("workspace review preference defaults remain undefined", () => {
	assertEquals(normalizeWorkspaceReviewPreferences(undefined), {});
	assertEquals(normalizeWorkspaceReviewPreferences({}), {
		changesRatio: undefined,
		gitPaneRatio: undefined,
		layout: undefined,
		mode: undefined,
		reviewSidebarWidth: undefined,
		tab: undefined,
		wrap: undefined,
	});
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
			tab: undefined,
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
			tab: undefined,
			wrap: undefined,
		},
	);
});

test("workspace review preferences persist without replacing future config", async () => {
	const directory = await makeTempDir();
	const path = `${directory}/nested/preferences.json`;
	try {
		assertEquals(await readWorkspaceReviewPreferences(path), {});
		await mkdir(`${directory}/nested`);
		await writeTextFile(path, '{"futureSetting":true}\n');
		const preferences = {
			changesRatio: 0.4,
			gitPaneRatio: 0.6,
			layout: "unified" as const,
			mode: "selected" as const,
			reviewSidebarWidth: 320,
			tab: "git" as const,
			wrap: false,
		};
		await writeWorkspaceReviewPreferences(preferences, path);
		assertEquals(await readWorkspaceReviewPreferences(path), preferences);
		assertEquals(JSON.parse(await readTextFile(path)), {
			futureSetting: true,
			gitView: preferences,
			$schema: appConfigSchemaUrl,
		});
	} finally {
		await remove(directory, { recursive: true });
	}
});
