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
