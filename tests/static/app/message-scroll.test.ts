import { test } from "bun:test";

import {
	hasPointerDragIntent,
	shouldRearmAfterScroll,
	shouldTrimOldMessages,
} from "#static/app/message-scroll.js";
import { assertEquals } from "#testing/assertions";

test("pointer presses require drag intent before releasing follow mode", () => {
	assertEquals(hasPointerDragIntent(100, 100, 100, 100), false);
	assertEquals(hasPointerDragIntent(100, 100, 107, 100), false);
	assertEquals(hasPointerDragIntent(100, 100, 108, 100), true);
	assertEquals(hasPointerDragIntent(100, 100, 106, 106), true);
});

test("old messages trim only when every candidate is above the viewport", () => {
	assertEquals(shouldTrimOldMessages(1, 99, 100), true);
	assertEquals(shouldTrimOldMessages(1, 101, 100), false);
	assertEquals(shouldTrimOldMessages(0, 99, 100), false);
});

test("downward scrolling that reaches the live edge re-arms following", () => {
	assertEquals(shouldRearmAfterScroll(false, 400, 420, 8), true);
	assertEquals(shouldRearmAfterScroll(false, 400, 420, 8.1), false);
	assertEquals(shouldRearmAfterScroll(false, 420, 400, 0), false);
	assertEquals(shouldRearmAfterScroll(true, 400, 420, 0), false);
});
