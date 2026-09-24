import { test } from "bun:test";

import { assertEquals, assertStringIncludes } from "#testing/assertions";
import { createStreamingHarness, waitForCondition } from "#testing/e2e-streaming-harness";
import { fakeDirectives } from "#testing/fake-stream-provider";
import { responseReader, readUntil } from "#testing/streams";

test("a scripted turn streams a real assistant reply with no network", async () => {
	const harness = await createStreamingHarness();
	try {
		const tab = new AbortController();
		const reader = responseReader(harness.openStream(tab.signal));
		await readUntil(reader, (text) => text.includes("event: datastar-patch-signals"));

		assertEquals(
			await harness.controller.prompt(fakeDirectives.text("hi there")),
			true,
		);

		await waitForCondition(
			() =>
				harness.store.messages.some((message) =>
					message.text.includes("Fake reply: hi there"),
				),
			{ message: "assistant reply did not arrive" },
		);

		const output = await readUntil(reader, (text) =>
			text.includes("Fake reply: hi there"),
		);
		assertStringIncludes(output, "event: datastar-patch-elements");

		const roles = harness.store.messages.map((message) => message.role);
		assertStringIncludes(roles.join(","), "thought,assistant");
		tab.abort();
	} finally {
		await harness.dispose();
	}
}, 15_000);
