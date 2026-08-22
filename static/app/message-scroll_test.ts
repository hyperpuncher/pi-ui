import { assertEquals } from "@std/assert";

import {
	hasPointerDragIntent,
	retainedAnchorScrollTop,
	shouldRearmAfterScroll,
} from "./message-scroll.js";

Deno.test("retained message anchor preserves its viewport offset", () => {
	assertEquals(retainedAnchorScrollTop(240, 760, 40), 960);
	assertEquals(retainedAnchorScrollTop(960, 40, 40), 960);
});

Deno.test("pointer presses require drag intent before releasing follow mode", () => {
	assertEquals(hasPointerDragIntent(100, 100, 100, 100), false);
	assertEquals(hasPointerDragIntent(100, 100, 107, 100), false);
	assertEquals(hasPointerDragIntent(100, 100, 108, 100), true);
	assertEquals(hasPointerDragIntent(100, 100, 106, 106), true);
});

Deno.test("downward user scrolling to the end re-arms following", () => {
	assertEquals(shouldRearmAfterScroll(false, 400, 420, 8, true), true);
	assertEquals(shouldRearmAfterScroll(false, 400, 420, 8.1, true), false);
	assertEquals(shouldRearmAfterScroll(false, 420, 400, 0, true), false);
	assertEquals(shouldRearmAfterScroll(false, 400, 420, 0, false), false);
});
