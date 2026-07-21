import { assertEquals } from "@std/assert";

import { pinnedAfterScroll, retainedAnchorScrollTop } from "./message-scroll.js";

Deno.test("retained message anchor preserves its viewport offset", () => {
	assertEquals(retainedAnchorScrollTop(240, 760, 40), 960);
	assertEquals(retainedAnchorScrollTop(960, 40, 40), 960);
});

Deno.test("stream growth cannot unpin a bottom-pinned transcript", () => {
	assertEquals(pinnedAfterScroll(true, 480, 480, 240), true);
	assertEquals(pinnedAfterScroll(true, 480, 360, 240), false);
	assertEquals(pinnedAfterScroll(false, 360, 600, 80), true);
});
