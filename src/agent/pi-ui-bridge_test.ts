import { test } from "bun:test";

import { assert, assertEquals, assertExists } from "#testing/assertions";

import { piUiMarker } from "../extension-surface-types.ts";
import { PiUiBridgeDecoder, PiUiElementStore } from "./pi-ui-bridge.ts";

function piui(payload: unknown): string {
	return piUiMarker + JSON.stringify(payload);
}

test("PiUiBridgeDecoder ignores non-PIUI messages", () => {
	const decoder = new PiUiBridgeDecoder();
	assertEquals(decoder.decode("hello"), undefined);
	assertEquals(PiUiBridgeDecoder.isPiUiMessage("hello"), false);
	assertEquals(PiUiBridgeDecoder.isPiUiMessage(piUiMarker + "{}"), true);
});

test("PiUiBridgeDecoder drops garbage and malformed payloads without throwing", () => {
	const decoder = new PiUiBridgeDecoder();
	assertEquals(decoder.decode(piui("not json") + "{broken"), undefined);
	assertEquals(decoder.decode(piUiMarker + "{not valid json"), undefined);
	assertEquals(decoder.decode(piUiMarker + "[]"), undefined);
	assertEquals(decoder.decode(piui({ v: 1, op: "unknown-op" })), undefined);
	assertEquals(decoder.decode(piui({ v: 1, op: "set" })), undefined);
	assertEquals(
		decoder.decode(piui({ v: 1, op: "set", el: "not-an-object" })),
		undefined,
	);
	assertEquals(
		decoder.decode(piui({ v: 1, op: "patch", id: "a" /* missing ns/patch */ })),
		undefined,
	);
});

test("PiUiBridgeDecoder decodes every documented op shape", () => {
	const decoder = new PiUiBridgeDecoder();
	const setOp = decoder.decode(
		piui({
			v: 1,
			op: "set",
			el: {
				id: "panel",
				ns: "advisor",
				kind: "panel",
				placement: "sheet",
				title: "Hi",
			},
		}),
	);
	assertEquals(setOp?.op, "set");

	const upsertOp = decoder.decode(
		piui({ v: 1, op: "upsert", element: { id: "s", ns: "n", kind: "status" } }),
	);
	assertEquals(upsertOp?.op, "upsert");

	const patchOp = decoder.decode(
		piui({
			v: 1,
			op: "patch",
			id: "panel",
			ns: "advisor",
			patch: { title: "Updated" },
		}),
	);
	assertEquals(patchOp, {
		op: "patch",
		id: "panel",
		ns: "advisor",
		patch: { title: "Updated" },
	});

	const appendOp = decoder.decode(
		piui({ v: 1, op: "append", id: "panel", ns: "advisor", data: "a log line" }),
	);
	assertEquals(appendOp, {
		op: "append",
		id: "panel",
		ns: "advisor",
		data: "a log line",
	});

	const removeOp = decoder.decode(
		piui({ v: 1, op: "remove", id: "panel", ns: "advisor" }),
	);
	assertEquals(removeOp, { op: "remove", id: "panel", ns: "advisor" });

	const channelOp = decoder.decode(
		piui({ v: 1, op: "channel", channel: "subagents:fleet", payload: { jobs: [] } }),
	);
	assertEquals(channelOp, {
		op: "channel",
		channel: "subagents:fleet",
		payload: { jobs: [] },
	});
});

test("PiUiBridgeDecoder drops lib/bridge.ts's back-to-back duplicate delivery", () => {
	const decoder = new PiUiBridgeDecoder();
	const first = piui({
		v: 1,
		agentSeq: 7,
		op: "append",
		id: "log",
		ns: "wf",
		data: "a",
	});
	const next = piui({
		v: 1,
		agentSeq: 8,
		op: "append",
		id: "log",
		ns: "wf",
		data: "a",
	});

	assertEquals(decoder.decode(first)?.op, "append");
	assertEquals(decoder.decode(first), undefined);
	// The same line appended again is a new payload (fresh agentSeq), so it still applies.
	assertEquals(decoder.decode(next)?.op, "append");
});

test("PiUiBridgeDecoder reassembles chunked payloads in and out of order", () => {
	const decoder = new PiUiBridgeDecoder();
	const original = { v: 1, op: "set", el: { id: "big", ns: "n", kind: "log" } };
	const json = JSON.stringify(original);
	const mid = Math.ceil(json.length / 2);
	const pieces = [json.slice(0, mid), json.slice(mid)];

	// Second piece arrives first: still incomplete until both are in.
	assertEquals(
		decoder.decode(
			piui({ v: 1, op: "chunk", id: "c1", i: 1, n: 2, data: pieces[1] }),
		),
		undefined,
	);
	const result = decoder.decode(
		piui({ v: 1, op: "chunk", id: "c1", i: 0, n: 2, data: pieces[0] }),
	);
	assertEquals(result, { op: "set", el: original.el });
});

test("PiUiBridgeDecoder rejects oversized and malformed chunk sequences", () => {
	const decoder = new PiUiBridgeDecoder();
	// Missing fields.
	assertEquals(decoder.decode(piui({ v: 1, op: "chunk", id: "x" })), undefined);
	// Declared total out of bounds.
	assertEquals(
		decoder.decode(piui({ v: 1, op: "chunk", id: "x", i: 0, n: 0, data: "a" })),
		undefined,
	);
	assertEquals(
		decoder.decode(piui({ v: 1, op: "chunk", id: "x", i: 0, n: 100_000, data: "a" })),
		undefined,
	);
	// Index out of range for the declared total never completes the sequence.
	assertEquals(
		decoder.decode(piui({ v: 1, op: "chunk", id: "x", i: 5, n: 2, data: "a" })),
		undefined,
	);
});

test("PiUiBridgeDecoder evicts the oldest chunk buffer once the pending limit is hit", () => {
	const decoder = new PiUiBridgeDecoder();
	// Open more distinct chunk ids than the buffer allows; the earliest ones
	// must be dropped rather than retained forever.
	for (let index = 0; index < 32; index += 1) {
		decoder.decode(
			piui({ v: 1, op: "chunk", id: `id-${index}`, i: 0, n: 2, data: "partial" }),
		);
	}
	// The very first id's buffer should have been evicted, so completing it
	// now starts a fresh (still incomplete) sequence rather than finishing.
	assertEquals(
		decoder.decode(piui({ v: 1, op: "chunk", id: "id-0", i: 1, n: 2, data: "rest" })),
		undefined,
	);
});

test("PiUiElementStore applies set/patch/append/remove/channel ops", () => {
	const store = new PiUiElementStore();
	assertEquals(
		store.apply({
			op: "set",
			el: {
				id: "panel",
				ns: "advisor",
				kind: "panel",
				placement: "sheet",
				title: "Advisor",
				text: "hello",
			},
		}),
		true,
	);
	let element = store.elements()[0];
	assertExists(element);
	assertEquals(element.id, "panel");
	assertEquals(element.ns, "advisor");
	assertEquals(element.kind, "panel");
	assertEquals(element.placement, "sheet");
	assertEquals(element.title, "Advisor");
	assertEquals(element.data, { text: "hello" });
	assertEquals(element.revision, 1);

	assertEquals(
		store.apply({
			op: "patch",
			id: "panel",
			ns: "advisor",
			patch: { text: "updated" },
		}),
		true,
	);
	const shownGeneration = element.openGeneration;
	element = store.elements()[0]!;
	assertEquals(element.data, { text: "updated" });
	assertEquals(element.revision, 2);
	// `patch` bumps `revision` but must NOT bump `openGeneration` — it's a content update to
	// an already-shown element, not a deliberate re-show (round-2 audit M4).
	assertEquals(element.openGeneration, shownGeneration);

	assertEquals(
		store.apply({ op: "append", id: "panel", ns: "advisor", data: "line one" }),
		true,
	);
	assertEquals(
		store.apply({ op: "append", id: "panel", ns: "advisor", data: "line two" }),
		true,
	);
	element = store.elements()[0]!;
	assertEquals(element.data.lines, ["line one", "line two"]);
	// `append` likewise must not bump `openGeneration`.
	assertEquals(element.openGeneration, shownGeneration);

	assertEquals(
		store.apply({ op: "channel", channel: "subagents:fleet", payload: { jobs: 1 } }),
		true,
	);
	assertEquals(store.channels(), [
		{
			channel: "subagents:fleet",
			payload: { jobs: 1 },
			updatedAt: element.updatedAt,
		},
	]);

	assertEquals(store.apply({ op: "remove", id: "panel", ns: "advisor" }), true);
	assertEquals(store.elements(), []);
});

test("re-`set`ing an existing element bumps openGeneration, unlike patch/append (M4)", () => {
	const store = new PiUiElementStore();
	store.apply({
		op: "set",
		el: { id: "sheet", ns: "btw", kind: "panel", placement: "sheet", text: "one" },
	});
	const first = store.elements()[0]!;
	assertEquals(first.revision, 1);

	store.apply({ op: "patch", id: "sheet", ns: "btw", patch: { text: "streaming" } });
	const patched = store.elements()[0]!;
	assertEquals(patched.revision, 2);
	assertEquals(
		patched.openGeneration,
		first.openGeneration,
		"a patch must not look like a fresh (re)show",
	);

	// A genuine re-`set` of the same id (e.g. the extension deliberately re-showing a sheet
	// the user dismissed) bumps both `revision` and `openGeneration`.
	store.apply({
		op: "set",
		el: { id: "sheet", ns: "btw", kind: "panel", placement: "sheet", text: "two" },
	});
	const reset = store.elements()[0]!;
	assertEquals(reset.revision, 3);
	assert(reset.openGeneration > first.openGeneration);
});

test("a new store never reuses an openGeneration a browser may have dismissed", () => {
	// Dismissals persist in the browser's localStorage by (dialog id, openGeneration), so a
	// fresh store (new session, /reload, server restart) must not start the count over.
	const show = () => {
		const store = new PiUiElementStore();
		store.apply({
			op: "set",
			el: { id: "panel", ns: "btw", kind: "panel", placement: "sheet" },
		});
		return store.elements()[0]!.openGeneration;
	};
	const earlier = show();
	assert(show() > earlier);
});

test("PiUiElementStore ignores patch/append targeting an element that was never set", () => {
	const store = new PiUiElementStore();
	assertEquals(
		store.apply({ op: "patch", id: "missing", ns: "n", patch: { title: "x" } }),
		false,
	);
	assertEquals(store.apply({ op: "append", id: "missing", ns: "n", data: "x" }), false);
	assertEquals(store.elements(), []);
});

test("PiUiElementStore drops set ops with an unknown kind rather than storing garbage", () => {
	const store = new PiUiElementStore();
	assertEquals(
		store.apply({
			op: "set",
			el: { id: "a", ns: "n", kind: "not-a-real-kind" },
		}),
		false,
	);
	assertEquals(store.elements(), []);
});

test("PiUiElementStore scopes elements by namespace, so two extensions can reuse the same id", () => {
	const store = new PiUiElementStore();
	store.apply({ op: "set", el: { id: "status", ns: "advisor", kind: "status" } });
	store.apply({ op: "set", el: { id: "status", ns: "subagents", kind: "status" } });
	assertEquals(store.elements().length, 2);
});

test("PiUiElementStore bounds appended lines to a tail", () => {
	const store = new PiUiElementStore();
	store.apply({ op: "set", el: { id: "log", ns: "n", kind: "log" } });
	for (let index = 0; index < 600; index += 1) {
		store.apply({ op: "append", id: "log", ns: "n", data: `line ${index}` });
	}
	const lines = store.elements()[0]!.data.lines as string[];
	assertEquals(lines.length <= 500, true);
	assertEquals(lines.at(-1), "line 599");
});

test("PiUiElementStore clear() empties both elements and channels", () => {
	const store = new PiUiElementStore();
	store.apply({ op: "set", el: { id: "a", ns: "n", kind: "status" } });
	store.apply({ op: "channel", channel: "c", payload: 1 });
	store.clear();
	assertEquals(store.elements(), []);
	assertEquals(store.channels(), []);
});

test("PiUiElementStore caps channels and evicts the oldest one", () => {
	const store = new PiUiElementStore();
	for (let index = 0; index < 70; index += 1) {
		store.apply({ op: "channel", channel: `c-${index}`, payload: index });
	}
	const channels = store.channels();
	assertEquals(channels.length <= 64, true);
	// The oldest channels (c-0, c-1, ...) were evicted; the newest survive.
	assertEquals(
		channels.some((channel) => channel.channel === "c-69"),
		true,
	);
	assertEquals(
		channels.some((channel) => channel.channel === "c-0"),
		false,
	);
});
