import { test } from "bun:test";

import {
	hasPointerDragIntent,
	shouldRearmAfterScroll,
} from "#static/app/message-scroll.js";
import { assertEquals } from "#testing/assertions";

test("pointer presses require drag intent before releasing follow mode", () => {
	assertEquals(hasPointerDragIntent(100, 100, 100, 100), false);
	assertEquals(hasPointerDragIntent(100, 100, 107, 100), false);
	assertEquals(hasPointerDragIntent(100, 100, 108, 100), true);
	assertEquals(hasPointerDragIntent(100, 100, 106, 106), true);
});

test("downward scrolling that reaches the live edge re-arms following", () => {
	assertEquals(shouldRearmAfterScroll(400, 420, 8), true);
	assertEquals(shouldRearmAfterScroll(400, 420, 8.1), false);
	assertEquals(shouldRearmAfterScroll(420, 400, 0), false);
});
