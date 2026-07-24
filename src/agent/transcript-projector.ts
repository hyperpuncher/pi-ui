import {
	parseSkillBlock,
	type AgentSessionEvent,
	type AgentSessionRuntime,
	type SessionEntry,
} from "@earendil-works/pi-coding-agent";

import type { AppMessageInput } from "../state/app-store.ts";
import type { TranscriptState } from "../state/transcript-state.ts";
import { isRecord } from "../utils/type-guards.ts";
import { collectCacheMisses, formatCacheMissNotice } from "./cache-miss.ts";
import {
	compactToolOutput,
	contentToText,
	formatToolResult,
	stripAnsi,
	toolTitle,
	toolTitleParts,
} from "./tool-presentation.ts";

export type ProjectedTranscript = Pick<TranscriptState, "replaceMessages">;
type AgentMessage = Extract<AgentSessionEvent, { type: "message_start" }>["message"];

export class TranscriptProjector {
	load(runtime: AgentSessionRuntime, state: ProjectedTranscript): void {
		const pending = new Map<string, { name: string; args: unknown }>();
		const entries = runtime.session.sessionManager.getBranch();
		const misses = runtime.session.settingsManager?.getShowCacheMissNotices()
			? collectCacheMisses(entries, runtime.session.modelRuntime)
			: undefined;
		state.replaceMessages(
			entries.flatMap((entry: SessionEntry) => {
				const miss =
					entry.type === "message" && entry.message.role === "assistant"
						? misses?.get(entry.message)
						: undefined;
				return this.entry(
					entry,
					pending,
					miss ? formatCacheMissNotice(miss) : undefined,
				);
			}),
		);
	}

	entry(
		entry: SessionEntry,
		pending: Map<string, { name: string; args: unknown }>,
		cacheMissNotice?: string,
	): AppMessageInput[] {
		const timestamp = new Date(entry.timestamp);
		if (entry.type === "message") {
			if (entry.message.role === "assistant") {
				for (const call of extractToolCalls(entry.message.content)) {
					pending.set(call.id, { name: call.name, args: call.arguments });
				}
			}
			if (entry.message.role === "toolResult") {
				const call = pending.get(entry.message.toolCallId);
				pending.delete(entry.message.toolCallId);
				return [toolResultToAppMessage(entry.message, timestamp, call)];
			}
			const messages = this.message(entry.message, timestamp);
			if (cacheMissNotice) {
				messages.push({ role: "notice", text: cacheMissNotice, timestamp });
			}
			return messages;
		}
		if (entry.type === "custom_message" && entry.display) {
			return [{ role: "system", text: contentToText(entry.content), timestamp }];
		}
		if (entry.type === "compaction") {
			return [
				{
					role: "compaction",
					text: entry.summary,
					timestamp,
					title: "[compaction]",
					meta: `compacted from ${entry.tokensBefore.toLocaleString()} tokens`,
				},
			];
		}
		if (entry.type === "branch_summary") {
			return [{ role: "system", text: entry.summary, timestamp }];
		}
		return [];
	}

	message(message: AgentMessage, timestamp: Date): AppMessageInput[] {
		switch (message.role) {
			case "user":
				return userContentToMessages(contentToText(message.content), timestamp);
			case "assistant":
				return assistantContentToMessages(message.content, timestamp);
			case "toolResult":
				return [toolResultToAppMessage(message, timestamp)];
			case "bashExecution":
				return [
					{
						role: "tool",
						text: compactToolOutput(message.output),
						timestamp,
						title: `$ ${message.command}`,
						titleParts: [{ text: `$ ${message.command}` }],
						meta:
							message.exitCode === undefined
								? "cancelled"
								: `exit ${message.exitCode}`,
						state: message.exitCode === 0 ? "success" : "error",
						format: "output",
					},
				];
			case "custom":
				return message.display
					? [
							{
								role: "system",
								text: contentToText(message.content),
								timestamp,
							},
						]
					: [];
			case "branchSummary":
				return [{ role: "system", text: message.summary, timestamp }];
			case "compactionSummary":
				return [
					{
						role: "compaction",
						text: message.summary,
						timestamp,
						title: "[compaction]",
						meta: `compacted from ${message.tokensBefore.toLocaleString()} tokens`,
					},
				];
		}
	}
}

export function userContentToMessages(text: string, timestamp: Date): AppMessageInput[] {
	const skill = parseSkillBlock(text);
	if (!skill) return [{ role: "user", text, timestamp }];
	const messages: AppMessageInput[] = [
		{
			role: "skill",
			text: skill.content,
			timestamp,
			title: "[skill]",
			meta: skill.name,
		},
	];
	if (skill.userMessage)
		messages.push({ role: "user", text: skill.userMessage, timestamp });
	return messages;
}

export function toolResultToAppMessage(
	message: AgentMessage & { role: "toolResult" },
	timestamp: Date,
	toolCall?: { name: string; args: unknown },
): AppMessageInput {
	const view = formatToolResult(message.toolName, message, {
		args: toolCall?.args,
		isError: message.isError,
	});
	return {
		role: "tool",
		text: view.text,
		timestamp,
		title: toolCall
			? toolTitle(
					message.isError ? "error" : "success",
					toolCall.name,
					toolCall.args,
				)
			: message.toolName,
		titleParts: toolCall ? toolTitleParts(toolCall.name, toolCall.args) : undefined,
		state: message.isError ? "error" : "success",
		format: view.format,
	};
}

export function extractToolCalls(
	content: unknown,
): Array<{ id: string; name: string; arguments: unknown }> {
	if (!Array.isArray(content)) return [];
	return content.flatMap((part) =>
		isRecord(part) &&
		part.type === "toolCall" &&
		typeof part.id === "string" &&
		typeof part.name === "string"
			? [{ id: part.id, name: part.name, arguments: part.arguments }]
			: [],
	);
}

export function assistantContentToMessages(
	content: Extract<AgentMessage, { role: "assistant" }>["content"],
	timestamp: Date,
): AppMessageInput[] {
	if (!Array.isArray(content))
		return [{ role: "assistant", text: contentToText(content), timestamp }];
	const messages: AppMessageInput[] = [];
	let assistantText = "";
	let thoughtText = "";
	for (const part of content) {
		if (
			isRecord(part) &&
			part.type === "thinking" &&
			typeof part.thinking === "string"
		) {
			thoughtText += `${thoughtText ? "\n\n" : ""}${part.thinking}`;
		} else if (
			isRecord(part) &&
			part.type === "text" &&
			typeof part.text === "string"
		) {
			assistantText += part.text;
		}
	}
	if (thoughtText.trim())
		messages.push({ role: "thought", text: thoughtText, timestamp });
	if (assistantText.trim())
		messages.push({ role: "assistant", text: stripAnsi(assistantText), timestamp });
	return messages;
}
