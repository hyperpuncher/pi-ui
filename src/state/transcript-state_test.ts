import { test } from "bun:test";

import { assertEquals } from "#testing/assertions";

import { TranscriptState } from "./transcript-state.ts";

const hint = { keys: "ctrl N", description: "New session" };
const timestamp = new Date("2026-01-01T00:00:00.000Z");

test("transcript state appends, streams, updates, and finishes messages", () => {
	const state = new TranscriptState(hint);
	const thoughtId = state.appendThoughtDelta("thinking");
	state.appendThoughtDelta(" more");
	const assistantId = state.appendAssistantDelta("answer");
	state.appendAssistantDelta(" done");
	const toolId = state.appendMessage("tool", "running", { state: "running" });
	state.updateMessage(toolId, { text: "complete", state: "success" });
	const active = state.finishAssistant();

	assertEquals(active, { assistantId, thoughtId: undefined });
	assertEquals(state.getMessageIndex(thoughtId), 0);
	assertEquals(state.getMessageIndex(assistantId), 1);
	assertEquals(state.getMessageIndex(toolId), 2);
	assertEquals(state.getMessageIndex("missing"), undefined);
	assertEquals(
		state.allMessages.map(({ id, role, text, state }) => ({ id, role, text, state })),
		[
			{ id: thoughtId, role: "thought", text: "thinking more", state: undefined },
			{ id: assistantId, role: "assistant", text: "answer done", state: undefined },
			{ id: toolId, role: "tool", text: "complete", state: "success" },
		],
	);
});

test("transcript snapshots restore independent domain state and queue metadata", () => {
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
	assertEquals(restored.getMessageIndex(activeId), 2);
	assertEquals(restored.allMessages[0].text, "old");
	assertEquals(restored.activityText, "Working...");
	assertEquals(restored.queuedSteeringMessages, ["steer"]);
	assertEquals(restored.queuedFollowUpMessages, ["follow"]);
	assertEquals(restored.activeAssistantMessageId, activeId);
});

test("live transcripts trim only when requested", () => {
	const state = new TranscriptState(hint);
	for (let index = 0; index < 101; index += 1) {
		state.appendMessage("tool", `message ${index}`);
	}
	assertEquals(state.messages.length, 101);
	assertEquals(state.trimOldMessages(), ["m-1"]);
	assertEquals(state.messages.length, 100);
	assertEquals(state.messages[0].text, "message 1");
	assertEquals(state.trimOldMessages(), []);
});

test("transcript paging and reset have no presentation state", () => {
	const state = new TranscriptState(hint);
	state.replaceMessages(
		Array.from({ length: 180 }, (_, index) => ({
			role: "assistant" as const,
			text: `message ${index}`,
			timestamp,
		})),
	);
	assertEquals(state.messages.length, 30);
	assertEquals(state.hasOlderMessages, true);
	const olderMessages = state.loadOlderMessages();
	assertEquals(olderMessages.length, 30);
	assertEquals(olderMessages[0].text, "message 120");
	assertEquals(olderMessages.at(-1)?.text, "message 149");
	while (state.hasOlderMessages) {
		assertEquals(state.loadOlderMessages().length <= 30, true);
	}
	assertEquals(state.messages.length, 180);
	assertEquals(state.messages[0].text, "message 0");
	assertEquals(state.loadOlderMessages(), []);

	assertEquals(state.showRecentMessages(), true);
	assertEquals(state.messages.length, 30);
	assertEquals(state.messages[0].text, "message 150");
	assertEquals(state.showRecentMessages(), false);

	const previousId = state.allMessages[0].id;
	state.reset({ keys: "new", description: "Different hint" });
	assertEquals(state.messages, []);
	assertEquals(state.getMessage(previousId), undefined);
	assertEquals(state.getMessageIndex(previousId), undefined);
	assertEquals(state.hasOlderMessages, false);
	assertEquals(state.emptyChatHint.keys, "new");
});
