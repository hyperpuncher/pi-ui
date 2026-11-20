import { test } from "bun:test";

import { PromptDrafts } from "#static/app/prompt-drafts.js";
import { assertEquals } from "#testing/assertions";

test("prompt drafts stay separate per session", () => {
	const drafts = new PromptDrafts();

	assertEquals(drafts.sync("first", "initial"), null);
	assertEquals(drafts.sync("first", "edited"), null);
	assertEquals(drafts.sync("second", "edited"), "");
	assertEquals(drafts.sync("first", "two"), "edited");
	assertEquals(drafts.sync("second", ""), "two");
	assertEquals(drafts.sync("first", "two"), "");
});

test("prompt drafts restore failed background prompts without overwriting edits", () => {
	const drafts = new PromptDrafts();

	drafts.sync("first", "");
	drafts.sync("second", "");
	drafts.restore("first", "retry me");
	assertEquals(drafts.sync("first", "draft two"), "retry me");

	drafts.restore("second", "should not overwrite");
	assertEquals(drafts.sync("second", "edited"), "draft two");
});
