import { test } from "bun:test";

import { assertEquals } from "#testing/assertions";

import {
	hasPointerDragIntent,
	retainedAnchorScrollTop,
	shouldRearmAfterScroll,
	shouldTrimOldMessages,
} from "./message-scroll.js";

test("retained message anchor preserves its viewport offset", () => {
	assertEquals(retainedAnchorScrollTop(240, 760, 40), 960);
	assertEquals(retainedAnchorScrollTop(960, 40, 40), 960);
});

test("pointer presses require drag intent before releasing follow mode", () => {
	assertEquals(hasPointerDragIntent(100, 100, 100, 100), false);
	assertEquals(hasPointerDragIntent(100, 100, 107, 100), false);
	assertEquals(hasPointerDragIntent(100, 100, 108, 100), true);
	assertEquals(hasPointerDragIntent(100, 100, 106, 106), true);
});

test("old messages trim only when every candidate is above the viewport", () => {
	assertEquals(shouldTrimOldMessages(true, 1, 99, 100), true);
	assertEquals(shouldTrimOldMessages(true, 1, 101, 100), false);
	assertEquals(shouldTrimOldMessages(false, 1, 99, 100), false);
	assertEquals(shouldTrimOldMessages(true, 0, 99, 100), false);
});

test("downward user scrolling to the end re-arms following", () => {
	assertEquals(shouldRearmAfterScroll(false, 400, 420, 8, true), true);
	assertEquals(shouldRearmAfterScroll(false, 400, 420, 8.1, true), false);
	assertEquals(shouldRearmAfterScroll(false, 420, 400, 0, true), false);
	assertEquals(shouldRearmAfterScroll(false, 400, 420, 0, false), false);
});
