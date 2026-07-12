import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";

import type {
	TranscriptMessage,
	TranscriptMessageInput,
	TranscriptMessageOptions,
} from "../state/transcript-state.ts";

type EventOf<Type extends AgentSessionEvent["type"]> = Extract<
	AgentSessionEvent,
	{ type: Type }
>;

export type SessionEventStateSink = {
	appendMessage(
		role: TranscriptMessage["role"],
		text: string,
		options?: TranscriptMessageOptions,
	): string;
	updateMessage(id: string, patch: Partial<Omit<TranscriptMessage, "id">>): void;
	appendThoughtDelta(delta: string): void;
	appendAssistantDelta(delta: string): void;
	finishAssistant(): void;
	setActivityText(activityText: string | undefined): void;
	setQueuedMessages(steering: readonly string[], followUp: readonly string[]): void;
};

export type SessionEventToolState = {
	messageIds: Map<string, string>;
	callArgs: Map<string, unknown>;
	startedAt: Map<string, number>;
};

type ToolMessageView = {
	text: string;
	options: TranscriptMessageOptions;
};

export type SessionEventReducerContext = {
	state: SessionEventStateSink;
	tools: SessionEventToolState;
	convertMessage: (
		message: EventOf<"message_start">["message"],
		timestamp: Date,
	) => readonly TranscriptMessageInput[];
	formatToolStart: (event: EventOf<"tool_execution_start">) => ToolMessageView;
	formatToolUpdate: (
		event: EventOf<"tool_execution_update">,
	) => Partial<Omit<TranscriptMessage, "id">>;
	formatToolEnd: (
		event: EventOf<"tool_execution_end">,
		args: unknown,
		startedAt: number | undefined,
	) => ToolMessageView;
	syncUsage?: () => void;
	reloadMessages: () => void;
	now?: () => Date;
	nowMs?: () => number;
};

export type SessionEventReducerOutcome = {
	agentCompleted: boolean;
};

const noOutcome: SessionEventReducerOutcome = { agentCompleted: false };

export function reduceSessionEvent(
	event: AgentSessionEvent,
	context: SessionEventReducerContext,
): SessionEventReducerOutcome {
	const { state, tools } = context;
	switch (event.type) {
		case "agent_start":
			state.setActivityText("Working...");
			break;
		case "message_start":
			if (event.message.role === "toolResult") break;
			for (const message of context.convertMessage(
				event.message,
				context.now?.() ?? new Date(),
			)) {
				state.appendMessage(message.role, message.text, {
					title: message.title,
					titleParts: message.titleParts,
					meta: message.meta,
					state: message.state,
					format: message.format,
				});
			}
			break;
		case "message_update":
			if (event.assistantMessageEvent.type === "thinking_delta") {
				state.appendThoughtDelta(event.assistantMessageEvent.delta);
			}
			if (event.assistantMessageEvent.type === "text_delta") {
				state.appendAssistantDelta(event.assistantMessageEvent.delta);
			}
			break;
		case "message_end":
			if (event.message.role === "assistant") state.finishAssistant();
			context.syncUsage?.();
			break;
		case "tool_execution_start": {
			state.finishAssistant();
			tools.callArgs.set(event.toolCallId, event.args);
			tools.startedAt.set(event.toolCallId, context.nowMs?.() ?? Date.now());
			const view = context.formatToolStart(event);
			const id = state.appendMessage("tool", view.text, view.options);
			tools.messageIds.set(event.toolCallId, id);
			break;
		}
		case "tool_execution_update": {
			const id = tools.messageIds.get(event.toolCallId);
			if (id) state.updateMessage(id, context.formatToolUpdate(event));
			break;
		}
		case "tool_execution_end": {
			const id = tools.messageIds.get(event.toolCallId);
			const args = tools.callArgs.get(event.toolCallId) ?? {};
			const view = context.formatToolEnd(
				event,
				args,
				tools.startedAt.get(event.toolCallId),
			);
			if (id) state.updateMessage(id, { text: view.text, ...view.options });
			else state.appendMessage("tool", view.text, view.options);
			tools.messageIds.delete(event.toolCallId);
			tools.callArgs.delete(event.toolCallId);
			tools.startedAt.delete(event.toolCallId);
			break;
		}
		case "queue_update":
			state.setQueuedMessages(event.steering, event.followUp);
			break;
		case "agent_end":
			state.setActivityText(undefined);
			return { agentCompleted: true };
		case "auto_retry_start":
			state.setActivityText(`Retrying (${event.attempt}/${event.maxAttempts})...`);
			break;
		case "auto_retry_end":
			state.setActivityText(undefined);
			break;
		case "compaction_start":
			state.setActivityText(
				event.reason === "manual"
					? "Compacting context..."
					: `${event.reason === "overflow" ? "Context overflow detected, " : ""}Auto-compacting...`,
			);
			break;
		case "compaction_end":
			state.setActivityText(undefined);
			if (event.result) context.reloadMessages();
			if (event.errorMessage) state.appendMessage("system", event.errorMessage);
			break;
	}
	return noOutcome;
}
