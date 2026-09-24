import { test } from "bun:test";

import { assertEquals } from "#testing/assertions";

import { createTappedEventBus } from "./live-workspace-host-extension.ts";

test("createTappedEventBus taps every channel, not a fixed subset (A#27)", () => {
	const tapped: Array<[string, unknown]> = [];
	const bus = createTappedEventBus((channel, payload) =>
		tapped.push([channel, payload]),
	);

	bus.emit("subagents:fleet", { entries: [] });
	bus.emit("some-third-party-extension:custom-channel", { note: "unlisted" });

	assertEquals(tapped, [
		["subagents:fleet", { entries: [] }],
		["some-third-party-extension:custom-channel", { note: "unlisted" }],
	]);
});

test("createTappedEventBus still delivers to real subscribers exactly once", () => {
	const received: unknown[] = [];
	const bus = createTappedEventBus(() => {});
	bus.on("channel", (payload) => received.push(payload));

	bus.emit("channel", "hello");

	assertEquals(received, ["hello"]);
});

test("a throwing tap callback never reaches the extension's emit() call (AGENTS.md: never throw into pi)", () => {
	const received: unknown[] = [];
	const bus = createTappedEventBus(() => {
		throw new Error("malformed tap");
	});
	bus.on("channel", (payload) => received.push(payload));

	// Must not throw, and the real subscriber must still be reached.
	bus.emit("channel", "payload");

	assertEquals(received, ["payload"]);
});
