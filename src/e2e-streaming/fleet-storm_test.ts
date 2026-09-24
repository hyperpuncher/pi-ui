import { test } from "bun:test";

import { assertEquals } from "#testing/assertions";
import { createStreamingHarness, waitForCondition } from "#testing/e2e-streaming-harness";
import { fakeDirectives } from "#testing/fake-stream-provider";

test("a scripted sub-agent-style fleet publish updates the Live Workspace Agents tab live, at speed", async () => {
	const harness = await createStreamingHarness();
	try {
		const eventCount = 50;
		const intervalMs = 12; // ~80 events/s: at or above the plan's "50 events/s" bar.
		const started = Date.now();

		assertEquals(
			await harness.controller.prompt(fakeDirectives.fleet(eventCount, intervalMs)),
			true,
		);

		// Watch the roster label advance in real time while the tool call is still running
		// (not just check the end state), proving events land live rather than all at once
		// after the fact.
		let sawMidStorm = false;
		await waitForCondition(
			() => {
				const agents = harness.store.snapshot().liveWorkspace.agents;
				const last = agents.find((row) => row.source === "subagents:fleet");
				if (last && /scout-\d+/.test(last.label)) {
					const index = Number(last.label.split("-")[1]);
					if (index > 0 && index < eventCount - 1) sawMidStorm = true;
				}
				return last?.label === `scout-${eventCount - 1}`;
			},
			{
				timeoutMs: 15_000,
				message: "fleet storm never reached its last scripted event",
			},
		);
		const elapsedMs = Date.now() - started;

		await waitForCondition(
			() =>
				harness.store.messages.some((message) =>
					message.text.includes(`published ${eventCount} fleet events`),
				),
			{ message: "fleet_publish tool result never reached the transcript" },
		);
		await waitForCondition(
			() =>
				harness.store.messages.some((message) =>
					message.text.includes("fleet_publish finished (ok)"),
				),
			{ message: "turn never completed after the fleet storm" },
		);

		if (!sawMidStorm) {
			throw new Error(
				"never observed an intermediate fleet event — events may have batched instead of streaming live",
			);
		}
		// Sanity bound: the storm's own scripted delay is eventCount * intervalMs; the whole
		// turn (thinking + tool call + storm + wrap-up reply) should land within a small
		// multiple of that, not hang or silently serialize far slower.
		const budgetMs = eventCount * intervalMs * 5 + 5_000;
		if (elapsedMs > budgetMs) {
			throw new Error(
				`fleet storm took ${elapsedMs}ms, expected under ${budgetMs}ms`,
			);
		}
	} finally {
		await harness.dispose();
	}
}, 20_000);
