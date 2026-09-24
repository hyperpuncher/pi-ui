import { test } from "bun:test";

import { assertEquals, assertStringIncludes } from "#testing/assertions";
import { createStreamingHarness, waitForCondition } from "#testing/e2e-streaming-harness";
import { fakeDirectives } from "#testing/fake-stream-provider";
import { readUntil, responseReader } from "#testing/streams";

test("aborting mid-stream stops a real in-flight tool call early", async () => {
	const harness = await createStreamingHarness();
	try {
		assertEquals(await harness.controller.prompt(fakeDirectives.fleet(50, 12)), true);

		// Let the real fleet_publish tool get a handful of events out, then cut it off —
		// well short of the scripted 50, proving abort reached the running tool, not just
		// the model stream.
		await waitForCondition(
			() =>
				harness.store
					.snapshot()
					.liveWorkspace.agents.some((row) => row.source === "subagents:fleet"),
			{ message: "fleet storm never reached its third event before abort" },
		);
		await harness.controller.abort();

		await waitForCondition(
			() => harness.store.transcript.activeAssistantMessageId === undefined,
			{
				message: "turn never settled after abort",
			},
		);
		const published = harness.store.messages.find(
			(message) => message.role === "tool" && message.title === "fleet_publish",
		);
		if (!published)
			throw new Error(
				"expected the fleet_publish tool message to remain in the transcript",
			);
		const match = /published (\d+) fleet events/.exec(published.text);
		if (!match)
			throw new Error(`unexpected fleet_publish tool text: ${published.text}`);
		const count = Number(match[1]);
		if (!(count < 50)) {
			throw new Error(
				`expected the abort to interrupt the tool before all 50 events, got ${count}`,
			);
		}
	} finally {
		await harness.dispose();
	}
}, 20_000);

test("a follow-up prompt sent while streaming queues instead of interrupting the live turn", async () => {
	const harness = await createStreamingHarness();
	try {
		assertEquals(await harness.controller.prompt(fakeDirectives.fleet(50, 12)), true);
		// `session.isStreaming` (which gates "steer"/"followUp" vs. a plain new turn, see
		// `PromptLifecycle.submit`) covers only active token generation, not tool
		// execution — catch the prompt while the scripted thinking block is still
		// streaming, before the tool call even starts.
		await waitForCondition(
			() =>
				harness.store.messages.some(
					(message) => message.role === "thought" && message.text.length > 0,
				),
			{ message: "first turn never started streaming" },
		);

		assertEquals(
			await harness.controller.prompt(fakeDirectives.text("queued-reply"), {
				streamingBehavior: "followUp",
			}),
			true,
		);
		// The queue_update session event lands a tick after the "accepted" promise
		// resolves, so poll rather than reading `queuedFollowUp` synchronously.
		await waitForCondition(
			() => harness.store.snapshot().liveWorkspace.queuedFollowUp === 1,
			{
				message: "the follow-up was never reflected as queued",
			},
		);
		// The queued prompt must not appear in the transcript (and must not disturb the
		// live turn) until the first turn actually finishes.
		assertEquals(
			harness.store.messages.some((message) =>
				message.text.includes("Fake reply: queued-reply"),
			),
			false,
		);

		await waitForCondition(
			() =>
				harness.store.messages.some((message) =>
					message.text.includes("fleet_publish finished (ok)"),
				),
			{ message: "first turn never completed" },
		);
		await waitForCondition(
			() =>
				harness.store.messages.some((message) =>
					message.text.includes("Fake reply: queued-reply"),
				),
			{ message: "queued follow-up never ran after the first turn completed" },
		);
		assertEquals(harness.store.snapshot().liveWorkspace.queuedFollowUp, 0);
	} finally {
		await harness.dispose();
	}
}, 20_000);

test("a steering prompt sent while streaming is queued as steering and then answered", async () => {
	const harness = await createStreamingHarness();
	try {
		assertEquals(await harness.controller.prompt(fakeDirectives.fleet(50, 12)), true);
		// Same window as the follow-up test: `session.isStreaming` covers token generation.
		await waitForCondition(
			() =>
				harness.store.messages.some(
					(message) => message.role === "thought" && message.text.length > 0,
				),
			{ message: "first turn never started streaming" },
		);

		assertEquals(
			await harness.controller.prompt(fakeDirectives.text("steered-reply"), {
				streamingBehavior: "steer",
			}),
			true,
		);
		// Steering is counted separately from follow-ups, never as a follow-up.
		await waitForCondition(
			() => harness.store.snapshot().liveWorkspace.queuedSteering === 1,
			{ message: "the steering prompt was never reflected as queued steering" },
		);
		assertEquals(harness.store.snapshot().liveWorkspace.queuedFollowUp, 0);

		await waitForCondition(
			() =>
				harness.store.messages.some((message) =>
					message.text.includes("Fake reply: steered-reply"),
				),
			{ message: "the steering prompt was never delivered and answered" },
		);
		assertEquals(harness.store.snapshot().liveWorkspace.queuedSteering, 0);
	} finally {
		await harness.dispose();
	}
}, 20_000);

test("switching sessions mid-stream backgrounds the streaming session instead of dropping it", async () => {
	const harness = await createStreamingHarness();
	try {
		assertEquals(await harness.controller.prompt(fakeDirectives.fleet(50, 12)), true);
		await waitForCondition(
			() =>
				harness.store
					.snapshot()
					.liveWorkspace.agents.some((row) => row.source === "subagents:fleet"),
			{ message: "streaming turn never started" },
		);

		const result = await harness.controller.newSession();
		assertEquals(result.status, "success");

		// The foreground transcript is the new, empty session — the streaming turn's
		// messages must not bleed into it (AGENTS.md non-negotiable).
		assertEquals(
			harness.store.messages.some((message) =>
				message.text.includes("Dispatch the fleet"),
			),
			false,
		);
		// ...but the backgrounded session keeps running and shows up as its own roster row.
		await waitForCondition(
			() =>
				harness.store
					.snapshot()
					.liveWorkspace.agents.some(
						(row) => row.kind === "background-session",
					),
			{
				message:
					"the backgrounded streaming session never appeared in the Agents tab",
			},
		);
	} finally {
		await harness.dispose();
	}
}, 20_000);

test("reconnecting mid-stream resumes seeing the live turn instead of a stale or broken view", async () => {
	const harness = await createStreamingHarness();
	try {
		const clientId = crypto.randomUUID();
		const firstConnection = new AbortController();
		const firstReader = responseReader(
			harness.openStream(firstConnection.signal, clientId),
		);
		await readUntil(firstReader, (text) =>
			text.includes("event: datastar-patch-signals"),
		);

		assertEquals(await harness.controller.prompt(fakeDirectives.fleet(50, 12)), true);
		await waitForCondition(
			() =>
				harness.store
					.snapshot()
					.liveWorkspace.agents.some((row) => row.source === "subagents:fleet"),
			{ message: "streaming turn never started before the simulated disconnect" },
		);

		// Simulate the tab going away mid-turn (network blip, backgrounded browser tab, ...).
		firstConnection.abort();

		// Wait for the *fully streamed* final reply, not just its opening words: the
		// wrap-up text streams in incrementally like everything else, and "fleet_publish
		// finished (ok)" is a substring of its very first delta.
		await waitForCondition(
			() =>
				harness.store.messages.some((message) =>
					message.text.includes("published 50 fleet events"),
				),
			{ message: "turn never completed while disconnected" },
		);

		const secondConnection = new AbortController();
		const secondReader = responseReader(
			harness.openStream(secondConnection.signal, clientId),
		);
		const resync = await readUntil(secondReader, (text) =>
			text.includes("event: datastar-patch-signals"),
		);
		assertStringIncludes(resync, "event: datastar-patch-elements");
		const output = await readUntil(secondReader, (text) =>
			text.includes("published 50 fleet events"),
		);
		assertStringIncludes(output, "published 50 fleet events");
		secondConnection.abort();
	} finally {
		await harness.dispose();
	}
}, 20_000);

test("two tabs open on the same session see the same streamed turn", async () => {
	const harness = await createStreamingHarness();
	try {
		const tabA = new AbortController();
		const tabB = new AbortController();
		const readerA = responseReader(
			harness.openStream(tabA.signal, crypto.randomUUID()),
		);
		const readerB = responseReader(
			harness.openStream(tabB.signal, crypto.randomUUID()),
		);
		await readUntil(readerA, (text) =>
			text.includes("event: datastar-patch-signals"),
		);
		await readUntil(readerB, (text) =>
			text.includes("event: datastar-patch-signals"),
		);

		assertEquals(
			await harness.controller.prompt(fakeDirectives.text("multi-tab")),
			true,
		);

		const outputA = await readUntil(readerA, (text) =>
			text.includes("Fake reply: multi-tab"),
		);
		const outputB = await readUntil(readerB, (text) =>
			text.includes("Fake reply: multi-tab"),
		);
		assertStringIncludes(outputA, "Fake reply: multi-tab");
		assertStringIncludes(outputB, "Fake reply: multi-tab");
		tabA.abort();
		tabB.abort();
	} finally {
		await harness.dispose();
	}
}, 20_000);
