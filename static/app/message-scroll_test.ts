import { assertEquals } from "@std/assert";

import { retainedAnchorScrollTop } from "./message-scroll.js";

Deno.test("retained message anchor preserves its viewport offset", () => {
	assertEquals(retainedAnchorScrollTop(240, 760, 40), 960);
	assertEquals(retainedAnchorScrollTop(960, 40, 40), 960);
});
