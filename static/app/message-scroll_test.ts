import { assertEquals } from "@std/assert";

import { retainedAnchorScrollTop, shouldRearmAfterScroll } from "./message-scroll.js";

Deno.test("retained message anchor preserves its viewport offset", () => {
	assertEquals(retainedAnchorScrollTop(240, 760, 40), 960);
	assertEquals(retainedAnchorScrollTop(960, 40, 40), 960);
});

Deno.test("downward user scrolling to the end re-arms following", () => {
	assertEquals(shouldRearmAfterScroll(false, 400, 420, 8, true), true);
	assertEquals(shouldRearmAfterScroll(false, 400, 420, 8.1, true), false);
	assertEquals(shouldRearmAfterScroll(false, 420, 400, 0, true), false);
	assertEquals(shouldRearmAfterScroll(false, 400, 420, 0, false), false);
});
