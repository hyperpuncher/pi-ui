import {
	parseSkillBlock,
	type AgentSessionEvent,
	type AgentSessionRuntime,
	type SessionEntry,
} from "@earendil-works/pi-coding-agent";

import type { AppMessageInput } from "../state/app-store.ts";
import type { TranscriptState } from "../state/transcript-state.ts";
import {
	attachmentDisplayName,
	splitLeadingAttachmentReferences,
} from "../utils/attachment-references.ts";
import { isRecord, isString } from "../utils/type-guards.ts";
import { collectCacheMisses, formatCacheMissNotice } from "./cache-miss.ts";
import { formatProviderErrorMessage } from "./provider-error-message.ts";
import type { ToolArguments } from "./session-event-reducer.ts";
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
type UserContent = Extract<AgentMessage, { role: "user" }>["content"];
type AssistantContent = Extract<AgentMessage, { role: "assistant" }>["content"];
type AssistantContentPart = Extract<AssistantContent, readonly object[]>[number];
type AgentToolCall = Extract<AssistantContentPart, { type: "toolCall" }>;

export class TranscriptProjector {
	load(runtime: AgentSessionRuntime, state: ProjectedTranscript): void {
		const pending = new Map<string, { name: string; args: ToolArguments }>();
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
		pending: Map<string, { name: string; args: ToolArguments }>,
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
					meta: `compacted from ${entry.tokensBefore.toLocaleString()} tokens`,
				},
			];
		}
		if (entry.type === "branch_summary") {
			return [{ role: "summary", text: entry.summary, timestamp }];
		}
		return [];
	}

	message(
		message: AgentMessage,
		timestamp: Date,
		options: { includeAssistantError?: boolean } = {},
	): AppMessageInput[] {
		switch (message.role) {
			case "user": {
				const text = userContentRawText(message.content);
				const { prompt, paths } = splitLeadingAttachmentReferences(text);
				return userContentToMessages(
					prompt,
					timestamp,
					userContentAttachments(paths, message.content),
				);
			}
			case "assistant": {
				const messages = assistantContentToMessages(message.content, timestamp);
				if (
					options.includeAssistantError !== false &&
					message.stopReason === "error"
				) {
					messages.push({
						role: "system",
						text: formatProviderErrorMessage(message.errorMessage),
						timestamp,
						state: "error",
					});
				}
				return messages;
			}
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
				return [{ role: "summary", text: message.summary, timestamp }];
			case "compactionSummary":
				return [
					{
						role: "compaction",
						text: message.summary,
						timestamp,
						meta: `compacted from ${message.tokensBefore.toLocaleString()} tokens`,
					},
				];
		}
	}
}

export function userContentToMessages(
	text: string,
	timestamp: Date,
	attachments?: AppMessageInput["attachments"],
): AppMessageInput[] {
	const skill = parseSkillBlock(text);
	if (!skill) {
		const message: AppMessageInput = { role: "user", text, timestamp };
		if (attachments?.length) message.attachments = attachments;
		return [message];
	}
	const messages: AppMessageInput[] = [
		{
			role: "skill",
			text: skill.content,
			timestamp,
			meta: skill.name,
		},
	];
	if (skill.userMessage || attachments?.length)
		messages.push({
			role: "user",
			text: skill.userMessage ?? "",
			timestamp,
			attachments,
		});
	return messages;
}

function userContentRawText(content: UserContent): string {
	return Array.isArray(content)
		? content
				.flatMap((part) =>
					isRecord(part) && part.type === "text" && isString(part.text)
						? [stripAnsi(part.text)]
						: [],
				)
				.join("\n")
		: contentToText(content);
}

function userContentAttachments(
	paths: readonly string[],
	content: UserContent,
): AppMessageInput["attachments"] {
	const images = Array.isArray(content)
		? content.flatMap((part) =>
				isRecord(part) &&
				part.type === "image" &&
				isString(part.data) &&
				isString(part.mimeType) &&
				/^image\/[a-z0-9.+-]+$/i.test(part.mimeType)
					? [{ data: part.data, mimeType: part.mimeType }]
					: [],
			)
		: [];
	let imageIndex = 0;
	const attachments: NonNullable<AppMessageInput["attachments"]> = paths.map((path) => {
		const name = attachmentDisplayName(path);
		const image = isImageFileName(name) ? images[imageIndex++] : undefined;
		const attachment: NonNullable<AppMessageInput["attachments"]>[number] = {
			name,
			path,
			mimeType: image?.mimeType ?? mimeTypeFromName(name),
		};
		if (image) attachment.image = image;
		return attachment;
	});
	for (; imageIndex < images.length; imageIndex += 1) {
		attachments.push({
			name: `Image ${imageIndex + 1}`,
			mimeType: images[imageIndex].mimeType,
			image: images[imageIndex],
		});
	}
	return attachments.length > 0 ? attachments : undefined;
}

function isImageFileName(name: string): boolean {
	return /\.(?:jpe?g|png|gif|webp|bmp)$/i.test(name);
}

function mimeTypeFromName(name: string): string | undefined {
	const extension = name.split(".").at(-1)?.toLowerCase();
	const types = new Map<string, string>(
		Object.entries({
			txt: "text/plain",
			md: "text/markdown",
			json: "application/json",
			pdf: "application/pdf",
			ogg: "audio/ogg",
			mp3: "audio/mpeg",
			wav: "audio/wav",
		}),
	);
	return extension ? types.get(extension) : undefined;
}

function toolResultToAppMessage(
	message: AgentMessage & { role: "toolResult" },
	timestamp: Date,
	toolCall?: { name: string; args: ToolArguments },
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

function extractToolCalls<Content>(
	content: Content,
): Array<Pick<AgentToolCall, "id" | "name" | "arguments">> {
	if (!Array.isArray(content)) return [];
	return content.flatMap((part) =>
		isRecord(part) &&
		part.type === "toolCall" &&
		isString(part.id) &&
		isString(part.name)
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
		if (isRecord(part) && part.type === "thinking" && isString(part.thinking)) {
			thoughtText += `${thoughtText ? "\n\n" : ""}${part.thinking}`;
		} else if (isRecord(part) && part.type === "text" && isString(part.text)) {
			assistantText += part.text;
		}
	}
	if (thoughtText.trim())
		messages.push({ role: "thought", text: thoughtText, timestamp });
	if (assistantText.trim())
		messages.push({ role: "assistant", text: stripAnsi(assistantText), timestamp });
	return messages;
}
