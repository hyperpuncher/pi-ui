import { TranscriptState } from "./transcript-state.ts";

const hint = { keys: "ctrl N", description: "New session" };
const timestamp = new Date("2026-01-01T00:00:00.000Z");

Deno.test("transcript state has no presentation or transport dependencies", async () => {
	const source = await Deno.readTextFile(
		new URL("./transcript-state.ts", import.meta.url),
	);
	for (const forbidden of [
		"../ui/",
		"../server/",
		"renderMarkdown",
		"Datastar",
		"StreamingFrameScheduler",
	]) {
		if (source.includes(forbidden)) {
			throw new Error(`Headless transcript contains ${forbidden}`);
		}
	}
});

Deno.test("transcript state appends, streams, updates, and finishes messages", () => {
	const state = new TranscriptState(hint);
	const thoughtId = state.appendThoughtDelta("thinking");
	state.appendThoughtDelta(" more");
	const assistantId = state.appendAssistantDelta("answer");
	state.appendAssistantDelta(" done");
	const toolId = state.appendMessage("tool", "running", { state: "running" });
	state.updateMessage(toolId, { text: "complete", state: "success" });
	const active = state.finishAssistant();

	assertEquals(active, { assistantId, thoughtId: undefined });
	assertEquals(
		state.allMessages.map(({ id, role, text, state }) => ({ id, role, text, state })),
		[
			{ id: thoughtId, role: "thought", text: "thinking more", state: undefined },
			{ id: assistantId, role: "assistant", text: "answer done", state: undefined },
			{ id: toolId, role: "tool", text: "complete", state: "success" },
		],
	);
});

Deno.test("transcript snapshots restore independent domain state and queue metadata", () => {
	const original = new TranscriptState(hint);
	original.replaceMessages([
		{ role: "user", text: "old", timestamp },
		{ role: "assistant", text: "restored", timestamp },
	]);
	const activeId = original.appendAssistantDelta("streaming");
	original.setActivityText("Working...");
	original.setQueuedMessages(["steer"], ["follow"]);
	const snapshot = original.snapshot();
	const restored = new TranscriptState({ keys: "x", description: "x" });
	restored.restore(snapshot);

	snapshot.transcriptMessages[0].text = "mutated snapshot";
	assertEquals(restored.getMessage(activeId)?.text, "streaming");
	assertEquals(restored.allMessages[0].text, "old");
	assertEquals(restored.activityText, "Working...");
	assertEquals(restored.queuedSteeringMessages, ["steer"]);
	assertEquals(restored.queuedFollowUpMessages, ["follow"]);
	assertEquals(restored.activeAssistantMessageId, activeId);
});

Deno.test("transcript paging and reset have no presentation state", () => {
	const state = new TranscriptState(hint);
	state.replaceMessages(
		Array.from({ length: 200 }, (_, index) => ({
			role: "assistant" as const,
			text: `message ${index}`,
			timestamp,
		})),
	);
	assertEquals(state.messages.length, 100);
	assertEquals(state.hasOlderMessages, true);
	assertEquals(state.loadOlderMessages().length, 100);
	assertEquals(state.messages.length, 200);
	assertEquals(state.loadOlderMessages(), []);

	state.reset({ keys: "new", description: "Different hint" });
	assertEquals(state.messages, []);
	assertEquals(state.hasOlderMessages, false);
	assertEquals(state.emptyChatHint.keys, "new");
});

function assertEquals(actual: unknown, expected: unknown): void {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(
			`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
		);
	}
}
