import { test } from "bun:test";

import { assertEquals } from "#testing/assertions";

import { AppStore } from "./app-store.ts";

test("prompt history contains the latest 100 user messages newest first", () => {
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

test("prompt history skips empty and non-user messages and collapses only consecutive prompts", () => {
	const store = new AppStore();
	assertEquals(store.promptHistory, []);
	store.replaceMessages([
		{ role: "user", text: " first ", timestamp: new Date(0) },
		{ role: "assistant", text: "reply", timestamp: new Date(1) },
		{ role: "user", text: "\t\n", timestamp: new Date(2) },
		{ role: "user", text: "first", timestamp: new Date(3) },
		{ role: "user", text: "second", timestamp: new Date(4) },
		{ role: "user", text: "first", timestamp: new Date(5) },
		{ role: "tool", text: "output", timestamp: new Date(6) },
	]);

	assertEquals(store.promptHistory, ["first", "second", "first"]);
});
