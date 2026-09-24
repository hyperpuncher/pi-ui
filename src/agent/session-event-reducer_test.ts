import { test } from "bun:test";

import type { AgentSessionEvent, CustomEntry } from "@earendil-works/pi-coding-agent";

import { assertEquals } from "#testing/assertions";

import type {
	FinishedAssistantIds,
	TranscriptMessage,
	TranscriptMessageOptions,
} from "../state/transcript-state.ts";
import {
	createSessionEventToolState,
	reduceSessionEvent,
	type SessionEventReducerContext,
	type SessionEventStateSink,
} from "./session-event-reducer.ts";
import { agentSessionEventStub, sessionEntryStub } from "./test-fixtures.ts";

class FakeState implements SessionEventStateSink {
	readonly appended: Array<{
		id: string;
		role: TranscriptMessage["role"];
		text: string;
		options: TranscriptMessageOptions;
	}> = [];
	readonly updates: Array<{
		id: string;
		patch: Partial<Omit<TranscriptMessage, "id">>;
	}> = [];
	readonly thoughts: string[] = [];
	readonly assistant: string[] = [];
	readonly activity: Array<string | undefined> = [];
	readonly queues: Array<{ steering: readonly string[]; followUp: readonly string[] }> =
		[];
	finishCount = 0;
	recentMessagesCount = 0;

	appendMessage(
		role: TranscriptMessage["role"],
		text: string,
		options: TranscriptMessageOptions = {},
	): string {
		const id = `message-${this.appended.length + 1}`;
		this.appended.push({ id, role, text, options });
		return id;
	}

	updateMessage(id: string, patch: Partial<Omit<TranscriptMessage, "id">>): void {
		this.updates.push({ id, patch });
	}

	private activeAssistantId: string | undefined;
	private activeThoughtId: string | undefined;

	appendThoughtDelta(delta: string): void {
		this.thoughts.push(delta);
		this.activeThoughtId ??= "thought-active";
	}

	appendAssistantDelta(delta: string): void {
		this.assistant.push(delta);
		this.activeAssistantId ??= "assistant-active";
	}

	finishAssistant(): FinishedAssistantIds {
		this.finishCount += 1;
		const ids = {
			assistantId: this.activeAssistantId,
			thoughtId: this.activeThoughtId,
		};
		this.activeAssistantId = undefined;
		this.activeThoughtId = undefined;
		return ids;
	}

	showRecentMessages(): void {
		this.recentMessagesCount += 1;
	}

	setActivityText(activityText: string | undefined): void {
		this.activity.push(activityText);
	}

	setQueuedMessages(steering: readonly string[], followUp: readonly string[]): void {
		this.queues.push({ steering, followUp });
	}
}

function fixture(options: { syncUsage?: () => void } = {}) {
	const state = new FakeState();
	const tools = createSessionEventToolState();
	const context: SessionEventReducerContext = {
		state,
		tools,
		convertMessage: (_message, timestamp) => [
			{ role: "user", text: `converted:${timestamp.getTime()}`, timestamp },
		],
		formatToolStart: (event) => ({
			text: `start:${event.toolName}`,
			options: { title: "running", state: "running", format: "pre" },
		}),
		formatToolPreview: (toolName, args) => ({
			text: `preview:${toolName}`,
			options: {
				title: JSON.stringify(args),
				state: "running",
				format: "pre",
			},
		}),
		formatToolUpdate: (event) => ({
			text: `update:${String(event.partialResult)}`,
			meta: "partial",
		}),
		formatToolEnd: (event, args, startedAt) => ({
			text: `end:${String(event.result)}`,
			options: {
				title: JSON.stringify(args),
				meta: String(startedAt),
				state: event.isError ? "error" : "success",
				format: "code",
			},
		}),
		syncUsage: options.syncUsage,
		now: () => new Date(123),
		nowMs: () => 456,
	};
	return { state, tools, context };
}

function event<Event extends { type: AgentSessionEvent["type"] }>(
	value: Event,
): AgentSessionEvent {
	return agentSessionEventStub(value);
}

function userMessage() {
	return { role: "user" as const, content: "hello", timestamp: 1 };
}

test("reduces agent, message, queue, and completion events", () => {
	let usageSyncs = 0;
	const { state, context } = fixture({ syncUsage: () => usageSyncs++ });

	reduceSessionEvent(event({ type: "agent_start" }), context);
	reduceSessionEvent(event({ type: "message_start", message: userMessage() }), context);
	reduceSessionEvent(
		event({
			type: "message_update",
			message: userMessage(),
			assistantMessageEvent: { type: "thinking_delta", delta: "think" },
		}),
		context,
	);
	reduceSessionEvent(
		event({
			type: "message_update",
			message: userMessage(),
			assistantMessageEvent: { type: "text_delta", delta: "answer" },
		}),
		context,
	);
	reduceSessionEvent(
		event({
			type: "message_end",
			message: { ...userMessage(), role: "assistant" },
		}),
		context,
	);
	reduceSessionEvent(
		event({ type: "queue_update", steering: ["now"], followUp: ["later"] }),
		context,
	);
	const attemptOutcome = reduceSessionEvent(
		event({ type: "agent_end", messages: [], willRetry: false }),
		context,
	);
	const outcome = reduceSessionEvent(event({ type: "agent_settled" }), context);

	assertEquals(attemptOutcome, { agentCompleted: false });
	assertEquals(state.activity, ["Working...", undefined]);
	assertEquals(state.appended[0], {
		id: "message-1",
		role: "user",
		text: "converted:123",
		options: {
			title: undefined,
			titleParts: undefined,
			meta: undefined,
			state: undefined,
			format: undefined,
		},
	});
	assertEquals(state.thoughts, ["think"]);
	assertEquals(state.assistant, ["answer"]);
	assertEquals(state.finishCount, 1);
	assertEquals(state.queues, [{ steering: ["now"], followUp: ["later"] }]);
	assertEquals(usageSyncs, 1);
	assertEquals(outcome, { agentCompleted: true });
});

test("surfaces the provider error when an assistant message fails", () => {
	const { state, context } = fixture();
	reduceSessionEvent(
		event({
			type: "message_end",
			message: {
				role: "assistant",
				content: [],
				stopReason: "error",
				errorMessage:
					'403: {"type":"RegionError","message":"This model requires explicit opt in."}',
			},
		}),
		context,
	);

	assertEquals(state.finishCount, 1);
	assertEquals(state.appended, [
		{
			id: "message-1",
			role: "system",
			text: `Error 403: {
	"type": "RegionError",
	"message": "This model requires explicit opt in."
}`,
			options: { state: "error" },
		},
	]);
});

test("does not surface a canonical abort as a provider error", () => {
	const { state, context } = fixture();
	reduceSessionEvent(
		event({
			type: "message_end",
			message: {
				role: "assistant",
				content: [],
				stopReason: "error",
				errorMessage: "The operation was aborted.",
			},
		}),
		context,
	);

	assertEquals(state.finishCount, 1);
	assertEquals(state.appended, []);
});

test("marks an aborted assistant message as stopped instead of erroring (round-4 O6)", () => {
	const { state, context } = fixture();
	state.appendAssistantDelta("partial reply");
	reduceSessionEvent(
		event({
			type: "message_end",
			message: {
				role: "assistant",
				content: [],
				stopReason: "error",
				errorMessage: "The operation was aborted.",
			},
		}),
		context,
	);

	assertEquals(state.finishCount, 1);
	assertEquals(state.appended, []);
	assertEquals(state.updates, [{ id: "assistant-active", patch: { meta: "Stopped" } }]);
});

test("marks a dedicated-stopReason abort as stopped (round-4 O6)", () => {
	// The SDK's actual abort path reports `stopReason: "aborted"` directly (no
	// `errorMessage` at all), distinct from the `"error"` + abort-worded-message
	// case covered above — both must produce the same muted marker.
	const { state, context } = fixture();
	state.appendAssistantDelta("partial reply");
	reduceSessionEvent(
		event({
			type: "message_end",
			message: { role: "assistant", content: [], stopReason: "aborted" },
		}),
		context,
	);

	assertEquals(state.finishCount, 1);
	assertEquals(state.appended, []);
	assertEquals(state.updates, [{ id: "assistant-active", patch: { meta: "Stopped" } }]);
});

test("marks the thinking block stopped when an abort lands before any reply text", () => {
	const { state, context } = fixture();
	state.appendThoughtDelta("still thinking");
	reduceSessionEvent(
		event({
			type: "message_end",
			message: { role: "assistant", content: [], stopReason: "aborted" },
		}),
		context,
	);

	assertEquals(state.appended, []);
	assertEquals(state.updates, [{ id: "thought-active", patch: { meta: "Stopped" } }]);
});

test("does not mark anything stopped when an abort lands before any assistant text streamed", () => {
	const { state, context } = fixture();
	reduceSessionEvent(
		event({
			type: "message_end",
			message: {
				role: "assistant",
				content: [],
				stopReason: "error",
				errorMessage: "The operation was aborted.",
			},
		}),
		context,
	);

	assertEquals(state.updates, []);
});

test("uses a fallback when a provider omits its error message", () => {
	const { state, context } = fixture();
	reduceSessionEvent(
		event({
			type: "message_end",
			message: { role: "assistant", content: [], stopReason: "error" },
		}),
		context,
	);

	assertEquals(state.appended[0]?.text, "Error: Unknown error");
});

test("skips tool-result message starts", () => {
	const { state, context } = fixture();
	reduceSessionEvent(
		event({
			type: "message_start",
			message: {
				role: "toolResult",
				toolCallId: "call",
				toolName: "read",
				content: [],
				isError: false,
				timestamp: 1,
			},
		}),
		context,
	);
	assertEquals(state.appended, []);
});

test("shows tools without rendering each streamed argument delta", () => {
	const { state, tools, context } = fixture();
	const partial = {
		role: "assistant",
		content: [
			{
				type: "toolCall",
				id: "call",
				name: "write",
				arguments: {},
			},
		],
	};
	reduceSessionEvent(
		event({
			type: "message_update",
			message: partial,
			assistantMessageEvent: {
				type: "toolcall_start",
				contentIndex: 0,
				partial,
			},
		}),
		context,
	);
	assertEquals(state.appended[0], {
		id: "message-1",
		role: "tool",
		text: "preview:write",
		options: {
			title: "{}",
			state: "running",
			format: "pre",
		},
	});
	assertEquals(tools.previewMessages.get(0)?.id, "message-1");

	const updatedPartial = {
		...partial,
		content: [{ ...partial.content[0], arguments: { path: "file.ts" } }],
	};
	reduceSessionEvent(
		event({
			type: "message_update",
			message: updatedPartial,
			assistantMessageEvent: {
				type: "toolcall_delta",
				contentIndex: 0,
				delta: '"path":"file.ts"',
				partial: updatedPartial,
			},
		}),
		context,
	);
	assertEquals(state.updates.at(-1), {
		id: "message-1",
		patch: {
			text: "preview:write",
			title: '{"path":"file.ts"}',
			state: "running",
			format: "pre",
		},
	});
	assertEquals(tools.previewMessages.get(0)?.argumentPrefix, undefined);
	reduceSessionEvent(
		event({
			type: "message_update",
			message: updatedPartial,
			assistantMessageEvent: {
				type: "toolcall_delta",
				contentIndex: 0,
				delta: ',"content":"ignored payload',
				partial: updatedPartial,
			},
		}),
		context,
	);
	assertEquals(state.updates.length, 1);

	reduceSessionEvent(
		event({
			type: "message_update",
			message: updatedPartial,
			assistantMessageEvent: {
				type: "toolcall_end",
				contentIndex: 0,
				toolCall: updatedPartial.content[0],
				partial: updatedPartial,
			},
		}),
		context,
	);
	assertEquals(state.updates.length, 1);
	reduceSessionEvent(
		event({
			type: "tool_execution_start",
			toolCallId: "call",
			toolName: "write",
			args: { path: "file.ts" },
		}),
		context,
	);

	assertEquals(state.appended.length, 1);
	assertEquals([...tools.messageIds], [["call", "message-1"]]);
	assertEquals(tools.previewMessages.size, 0);
	assertEquals(state.updates.at(-1), {
		id: "message-1",
		patch: {
			text: "start:write",
			title: "running",
			state: "running",
			format: "pre",
		},
	});
});

test("reduces one complete tool lifecycle and clears all tool maps", () => {
	const { state, tools, context } = fixture();
	reduceSessionEvent(
		event({
			type: "tool_execution_start",
			toolCallId: "call",
			toolName: "bash",
			args: { command: "pwd" },
		}),
		context,
	);
	assertEquals([...tools.messageIds], [["call", "message-1"]]);
	assertEquals([...tools.callArgs], [["call", { command: "pwd" }]]);
	assertEquals([...tools.startedAt], [["call", 456]]);

	reduceSessionEvent(
		event({
			type: "tool_execution_update",
			toolCallId: "call",
			toolName: "bash",
			args: { command: "pwd" },
			partialResult: "partial output",
		}),
		context,
	);
	reduceSessionEvent(
		event({
			type: "tool_execution_end",
			toolCallId: "call",
			toolName: "bash",
			result: "done",
			isError: false,
		}),
		context,
	);

	assertEquals(state.appended[0], {
		id: "message-1",
		role: "tool",
		text: "start:bash",
		options: { title: "running", state: "running", format: "pre" },
	});
	assertEquals(state.updates, [
		{
			id: "message-1",
			patch: { text: "update:partial output", meta: "partial" },
		},
		{
			id: "message-1",
			patch: {
				text: "end:done",
				title: '{"command":"pwd"}',
				meta: "456",
				state: "success",
				format: "code",
			},
		},
	]);
	assertEquals(tools.messageIds.size, 0);
	assertEquals(tools.callArgs.size, 0);
	assertEquals(tools.startedAt.size, 0);
});

test("appends an orphan tool end and removes stale map entries", () => {
	const { state, tools, context } = fixture();
	tools.callArgs.set("call", { path: "file" });
	tools.startedAt.set("call", 12);
	reduceSessionEvent(
		event({
			type: "tool_execution_end",
			toolCallId: "call",
			toolName: "read",
			result: "contents",
			isError: true,
		}),
		context,
	);
	assertEquals(state.appended[0], {
		id: "message-1",
		role: "tool",
		text: "end:contents",
		options: {
			title: '{"path":"file"}',
			meta: "12",
			state: "error",
			format: "code",
		},
	});
	assertEquals(
		tools.messageIds.size +
			tools.previewMessages.size +
			tools.callArgs.size +
			tools.startedAt.size,
		0,
	);
});

test("reduces retry and compaction lifecycle events", () => {
	const cases: Array<{ input: AgentSessionEvent; expected: string | undefined }> = [
		{
			input: event({
				type: "auto_retry_start",
				attempt: 2,
				maxAttempts: 4,
				delayMs: 10,
				errorMessage: "failed",
			}),
			expected: "Retrying (2/4)...",
		},
		{
			input: event({ type: "auto_retry_end", success: true, attempt: 2 }),
			expected: undefined,
		},
		{
			input: event({ type: "compaction_start", reason: "manual" }),
			expected: "Compacting context...",
		},
		{
			input: event({ type: "compaction_start", reason: "threshold" }),
			expected: "Auto compaction...",
		},
		{
			input: event({ type: "compaction_start", reason: "overflow" }),
			expected: "Auto compaction...",
		},
	];
	for (const testCase of cases) {
		const { state, context } = fixture();
		reduceSessionEvent(testCase.input, context);
		assertEquals(state.activity, [testCase.expected], testCase.input.type);
	}
});

test("successful compaction appends its timeline entry", () => {
	const { state, context } = fixture();
	reduceSessionEvent(
		event({
			type: "compaction_end",
			reason: "manual",
			result: {
				summary: "shorter",
				firstKeptEntryId: "entry-1",
				tokensBefore: 12_345,
			},
			aborted: false,
			willRetry: false,
		}),
		context,
	);
	assertEquals(state.appended, [
		{
			id: "message-1",
			role: "compaction",
			text: "shorter",
			options: { meta: "compacted from 12,345 tokens" },
		},
	]);
	assertEquals(state.activity, [undefined]);
	assertEquals(state.recentMessagesCount, 1);
});

test("failed compaction appends the error", () => {
	const { state, context } = fixture();
	reduceSessionEvent(
		event({
			type: "compaction_end",
			reason: "threshold",
			aborted: false,
			willRetry: false,
			errorMessage: "Compaction failed",
		}),
		context,
	);
	assertEquals(state.appended[0], {
		id: "message-1",
		role: "system",
		text: "Compaction failed",
		options: {},
	});
});

test("entry_appended renders a CustomEntry through convertEntry", () => {
	const { state, context } = fixture();
	const entry = sessionEntryStub({
		type: "custom",
		customType: "memory",
		data: { note: "hi" },
	}) as CustomEntry;
	let received: CustomEntry | undefined;
	const ctx: SessionEventReducerContext = {
		...context,
		convertEntry: (input, timestamp) => {
			received = input;
			return [
				{
					role: "custom",
					text: "",
					timestamp,
					meta: input.customType,
					customRenderHtml: ["<span>rendered</span>"],
				},
			];
		},
	};

	reduceSessionEvent(agentSessionEventStub({ type: "entry_appended", entry }), ctx);

	assertEquals(received, entry);
	assertEquals(state.appended, [
		{
			id: "message-1",
			role: "custom",
			text: "",
			options: {
				meta: "memory",
				customRenderHtml: ["<span>rendered</span>"],
				customRenderError: undefined,
			},
		},
	]);
});

test("entry_appended ignores entry types other than custom", () => {
	const { state, context } = fixture();
	const ctx: SessionEventReducerContext = {
		...context,
		convertEntry: () => {
			throw new Error("must not be called for a non-custom entry");
		},
	};

	reduceSessionEvent(
		agentSessionEventStub({
			type: "entry_appended",
			entry: sessionEntryStub({ type: "label", targetId: "x", label: "y" }),
		}),
		ctx,
	);

	assertEquals(state.appended, []);
});

test("entry_appended is a no-op with no convertEntry hook", () => {
	const { state, context } = fixture();
	const entry = sessionEntryStub({
		type: "custom",
		customType: "memory",
	}) as CustomEntry;

	reduceSessionEvent(agentSessionEventStub({ type: "entry_appended", entry }), context);

	assertEquals(state.appended, []);
});
