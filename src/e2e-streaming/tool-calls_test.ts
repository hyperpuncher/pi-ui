import { test } from "bun:test";

import { assertEquals } from "#testing/assertions";
import { createStreamingHarness, waitForCondition } from "#testing/e2e-streaming-harness";
import { fakeDirectives } from "#testing/fake-stream-provider";

test("a scripted turn drives a real bash tool call end to end", async () => {
	const harness = await createStreamingHarness();
	try {
		assertEquals(
			await harness.controller.prompt(fakeDirectives.bash("echo fake-stream-ok")),
			true,
		);

		// The real bash tool actually runs the command: `activeTools` reflects it while it
		// is in flight (the tool card renders below the editor via the same path a real
		// model's bash call would take).
		await waitForCondition(
			() =>
				harness.store.snapshot().liveWorkspace.activeTools.length > 0 ||
				harness.store.messages.some((message) => message.role === "tool"),
			{ message: "bash tool never appeared as active or in the transcript" },
		);

		await waitForCondition(
			() =>
				harness.store.messages.some((message) =>
					message.text.includes("fake-stream-ok"),
				),
			{ message: "bash tool output never reached the transcript" },
		);
		// The tool card's title reflects the streamed call arguments and only settles once
		// the argument delta finishes (`toolcall_end`), same as the tool's own live output.
		await waitForCondition(
			() =>
				harness.store.messages.some(
					(message) =>
						message.role === "tool" &&
						(message.title ?? "").includes("echo fake-stream-ok"),
				),
			{ message: "bash tool card title never showed the real command" },
		);

		// The scripted provider's wrap-up turn runs only after the real tool result comes
		// back, so this also proves the tool result round-tripped through the real session.
		await waitForCondition(
			() =>
				harness.store.messages.some((message) =>
					message.text.includes("bash finished (ok)"),
				),
			{ message: "wrap-up reply after the tool result never arrived" },
		);
		assertEquals(harness.store.snapshot().liveWorkspace.activeTools.length, 0);
	} finally {
		await harness.dispose();
	}
}, 15_000);

test("a scripted turn drives a real read tool call end to end", async () => {
	const harness = await createStreamingHarness();
	try {
		const filePath = `${harness.cwd}/fixture.txt`;
		await Bun.write(filePath, "fixture file contents for the read tool");

		assertEquals(
			await harness.controller.prompt(fakeDirectives.read(filePath)),
			true,
		);

		await waitForCondition(
			() =>
				harness.store.messages.some(
					(message) =>
						message.role === "tool" && message.title?.includes("fixture.txt"),
				),
			{ message: "read tool call never appeared in the transcript" },
		);
		await waitForCondition(
			() =>
				harness.store.messages.some((message) =>
					message.text.includes("read finished (ok)"),
				),
			{ message: "wrap-up reply after the read result never arrived" },
		);
	} finally {
		await harness.dispose();
	}
}, 15_000);

test("a 1000-line bash tool output streams through without breaking the transcript", async () => {
	const harness = await createStreamingHarness();
	try {
		assertEquals(
			await harness.controller.prompt(fakeDirectives.bigOutput(1000)),
			true,
		);

		await waitForCondition(
			() =>
				harness.store.messages.some((message) => message.text.includes("line-1")),
			{
				timeoutMs: 20_000,
				message: "large bash output never reached the transcript",
			},
		);
		await waitForCondition(
			() =>
				harness.store.messages.some((message) =>
					message.text.includes("bash finished (ok)"),
				),
			{
				timeoutMs: 20_000,
				message: "turn never completed after the large tool output",
			},
		);
		// Whatever cap pi-ui applies to tool output, the transcript entry itself must stay
		// well clear of the raw ~7KB payload blowing up into something unbounded.
		const toolMessage = harness.store.messages.find(
			(message) => message.role === "tool",
		);
		if (!toolMessage) throw new Error("expected a tool transcript message");
		if (toolMessage.text.length > 200_000) {
			throw new Error(
				`tool transcript text unexpectedly large: ${toolMessage.text.length} bytes`,
			);
		}
	} finally {
		await harness.dispose();
	}
}, 30_000);
