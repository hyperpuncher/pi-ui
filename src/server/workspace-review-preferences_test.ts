import { assertEquals } from "@std/assert";

import { normalizeWorkspaceReviewPreferences } from "../workspace-review-types.ts";
import {
	readWorkspaceReviewPreferences,
	writeWorkspaceReviewPreferences,
} from "./workspace-review-preferences.ts";

Deno.test("workspace review preferences validate and persist outside browser storage", async () => {
	const directory = await Deno.makeTempDir();
	const path = `${directory}/nested/preferences.json`;
	try {
		assertEquals(await readWorkspaceReviewPreferences(path), {});
		assertEquals(
			normalizeWorkspaceReviewPreferences({
				layout: "invalid",
				mode: "selected",
				wrap: false,
			}),
			{ layout: undefined, mode: "selected", wrap: false },
		);
		await Deno.mkdir(`${directory}/nested`);
		await Deno.writeTextFile(path, '{"futureSetting":true}\n');
		await writeWorkspaceReviewPreferences(
			{ layout: "unified", mode: "selected", wrap: false },
			path,
		);
		assertEquals(await readWorkspaceReviewPreferences(path), {
			layout: "unified",
			mode: "selected",
			wrap: false,
		});
		assertEquals(JSON.parse(await Deno.readTextFile(path)), {
			futureSetting: true,
			gitView: { layout: "unified", mode: "selected", wrap: false },
		});
	} finally {
		await Deno.remove(directory, { recursive: true });
	}
});
