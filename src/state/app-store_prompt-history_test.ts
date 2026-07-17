import { assertEquals } from "@std/assert";

import { AppStore } from "./app-store.ts";

Deno.test("prompt history contains the latest 100 user messages newest first", () => {
	const store = new AppStore();
	store.replaceMessages(
		Array.from({ length: 102 }, (_, index) => ({
			role: "user" as const,
			text: index === 101 ? " prompt 100 " : `prompt ${index}`,
			timestamp: new Date(index),
		})),
	);

	assertEquals(store.promptHistory.length, 100);
	assertEquals(store.promptHistory[0], "prompt 100");
	assertEquals(store.promptHistory.at(-1), "prompt 1");
});
