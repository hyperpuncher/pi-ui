import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";

import type { AppMessage, AppMessageOptions } from "../state/app-store.ts";
import {
	reduceSessionEvent,
	type SessionEventReducerContext,
	type SessionEventStateSink,
} from "./session-event-reducer.ts";

class FakeState implements SessionEventStateSink {
	readonly appended: Array<{
		id: string;
		role: AppMessage["role"];
		text: string;
		options: AppMessageOptions;
	}> = [];
	readonly updates: Array<{
		id: string;
		patch: Partial<Omit<AppMessage, "id">>;
	}> = [];
	readonly thoughts: string[] = [];
	readonly assistant: string[] = [];
	readonly activity: Array<string | undefined> = [];
	readonly queues: Array<{ steering: readonly string[]; followUp: readonly string[] }> =
		[];
	finishCount = 0;

	appendMessage(
		role: AppMessage["role"],
		text: string,
		options: AppMessageOptions = {},
	): string {
		const id = `message-${this.appended.length + 1}`;
		this.appended.push({ id, role, text, options });
		return id;
	}

	updateMessage(id: string, patch: Partial<Omit<AppMessage, "id">>): void {
		this.updates.push({ id, patch });
	}

	appendThoughtDelta(delta: string): void {
		this.thoughts.push(delta);
	}

	appendAssistantDelta(delta: string): void {
		this.assistant.push(delta);
	}

	finishAssistant(): void {
		this.finishCount += 1;
	}

	setActivityText(activityText: string | undefined): void {
		this.activity.push(activityText);
	}

	setQueuedMessages(steering: readonly string[], followUp: readonly string[]): void {
		this.queues.push({ steering, followUp });
	}
}

function fixture(options: { syncUsage?: () => void; reload?: () => void } = {}) {
	const state = new FakeState();
	const tools = {
		messageIds: new Map<string, string>(),
		callArgs: new Map<string, unknown>(),
		startedAt: new Map<string, number>(),
	};
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
		reloadMessages: options.reload ?? (() => {}),
		now: () => new Date(123),
		nowMs: () => 456,
	};
	return { state, tools, context };
}

function event(value: object): AgentSessionEvent {
	return value as AgentSessionEvent;
}

function userMessage() {
	return { role: "user" as const, content: "hello", timestamp: 1 };
}

Deno.test("reduces agent, message, queue, and completion events", () => {
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
	const outcome = reduceSessionEvent(
		event({ type: "agent_end", messages: [], willRetry: false }),
		context,
	);

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

Deno.test("background mode does not synchronize foreground usage", () => {
	const { context } = fixture();
	reduceSessionEvent(event({ type: "message_end", message: userMessage() }), context);
});

Deno.test("skips tool-result message starts", () => {
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

Deno.test("reduces one complete tool lifecycle and clears all tool maps", () => {
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

Deno.test("appends an orphan tool end and removes stale map entries", () => {
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
	assertEquals(tools.messageIds.size + tools.callArgs.size + tools.startedAt.size, 0);
});

Deno.test("reduces retry and compaction lifecycle events", async (t) => {
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
			expected: "Auto-compacting...",
		},
		{
			input: event({ type: "compaction_start", reason: "overflow" }),
			expected: "Context overflow detected, Auto-compacting...",
		},
	];
	for (const testCase of cases) {
		await t.step(testCase.input.type, () => {
			const { state, context } = fixture();
			reduceSessionEvent(testCase.input, context);
			assertEquals(state.activity, [testCase.expected]);
		});
	}
});

Deno.test("successful compaction reloads its own runtime state", () => {
	let reloads = 0;
	const { state, context } = fixture({ reload: () => reloads++ });
	reduceSessionEvent(
		event({
			type: "compaction_end",
			reason: "manual",
			result: { summary: "shorter" },
			aborted: false,
			willRetry: false,
		}),
		context,
	);
	assertEquals(reloads, 1);
	assertEquals(state.activity, [undefined]);
});

Deno.test("failed compaction appends the error without reloading", () => {
	let reloads = 0;
	const { state, context } = fixture({ reload: () => reloads++ });
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
	assertEquals(reloads, 0);
	assertEquals(state.appended[0], {
		id: "message-1",
		role: "system",
		text: "Compaction failed",
		options: {},
	});
});

function assertEquals(actual: unknown, expected: unknown): void {
	const actualJson = JSON.stringify(actual);
	const expectedJson = JSON.stringify(expected);
	if (actualJson !== expectedJson) {
		throw new Error(`Expected ${expectedJson}, received ${actualJson}`);
	}
}
