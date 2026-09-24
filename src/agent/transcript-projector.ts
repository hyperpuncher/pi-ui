import {
	parseSkillBlock,
	type AgentSessionEvent,
	type AgentSessionRuntime,
	type CustomEntry,
	type SessionEntry,
} from "@earendil-works/pi-coding-agent";

import type {
	TranscriptMessageInput,
	TranscriptState,
} from "../state/transcript-state.ts";
import {
	attachmentDisplayName,
	splitLeadingAttachmentReferences,
} from "../utils/attachment-references.ts";
import { isRecord, isString } from "../utils/type-guards.ts";
import { collectCacheMisses, formatCacheMissNotice } from "./cache-miss.ts";
import type { CustomRenderOutcome } from "./custom-renderer-host.ts";
import {
	formatProviderErrorMessage,
	isAbortErrorMessage,
} from "./provider-error-message.ts";
import type { ToolArguments } from "./session-event-reducer.ts";
import {
	compactToolOutput,
	contentToText,
	formatToolResult,
	stripAnsi,
	summarizeValue,
	toolTitle,
	toolTitleParts,
} from "./tool-presentation.ts";

export type ProjectedTranscript = Pick<TranscriptState, "replaceMessages">;

// `details`/`data` on a custom message or entry is an arbitrary, untrusted extension
// payload (see pi-protocol.md §5.2/5.3) — format it defensively and cap its size so one
// oversized object can't bloat a transcript patch.
const customDetailsTextLimit = 4000;

function detailsText<Details>(details: Details): string | undefined {
	if (details === undefined) return undefined;
	const text = summarizeValue(details);
	if (!text.trim()) return undefined;
	return text.length > customDetailsTextLimit
		? `${text.slice(0, customDetailsTextLimit)}\n… (truncated)`
		: text;
}
type AgentMessage = Extract<AgentSessionEvent, { type: "message_start" }>["message"];
type UserContent = Extract<AgentMessage, { role: "user" }>["content"];
type AssistantContent = Extract<AgentMessage, { role: "assistant" }>["content"];
type AssistantContentPart = Extract<AssistantContent, readonly object[]>[number];
type AgentToolCall = Extract<AssistantContentPart, { type: "toolCall" }>;
type CustomAgentMessage = Extract<AgentMessage, { role: "custom" }>;

/**
 * A `CustomMessageEntry`/live `custom` `AgentMessage`, rendered through the
 * extension's `MessageRenderer` when one is registered for its `customType`.
 * Matches the real interactive mode's `CustomMessageComponent`: a renderer
 * that throws or returns `undefined` falls straight back to the existing
 * plain-text/markdown rendering, silently — never a visible error, unlike a
 * `CustomEntry` (see `TranscriptProjector.customEntry`).
 */
function customMessageInput(
	message: CustomAgentMessage,
	timestamp: Date,
	renderMessage:
		| ((message: CustomAgentMessage) => CustomRenderOutcome | undefined)
		| undefined,
): TranscriptMessageInput {
	const outcome = renderMessage?.(message);
	return {
		role: "custom",
		text: contentToText(message.content),
		timestamp,
		meta: message.customType,
		details: detailsText(message.details),
		customRenderHtml: outcome?.ok ? outcome.lines : undefined,
	};
}

/**
 * Renders `pi.registerMessageRenderer`/`registerEntryRenderer` output for one
 * `customType`, supplied by the caller (`RuntimeController`) already bound to
 * the live `session.extensionRunner`, the requesting client's terminal width
 * and color scheme, and `CustomRendererHost`'s cache — see that module's doc
 * comment. Kept out of `TranscriptProjector` itself so this module stays
 * decoupled from the extension-runner/theme wiring and testable with plain
 * fakes; `undefined` here (rather than a function that always returns
 * `undefined`) means "no renderer host available yet" (e.g. very early
 * construction) and is treated exactly like "no renderer registered".
 */
export type TranscriptCustomRenderers = {
	readonly renderMessage: (
		message: CustomAgentMessage,
	) => CustomRenderOutcome | undefined;
	readonly renderEntry: (entry: CustomEntry) => CustomRenderOutcome | undefined;
};

export class TranscriptProjector {
	load(
		runtime: AgentSessionRuntime,
		state: ProjectedTranscript,
		renderers?: TranscriptCustomRenderers,
	): void {
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
					renderers,
				);
			}),
		);
	}

	entry(
		entry: SessionEntry,
		pending: Map<string, { name: string; args: ToolArguments }>,
		cacheMissNotice?: ReturnType<typeof formatCacheMissNotice>,
		renderers?: TranscriptCustomRenderers,
	): TranscriptMessageInput[] {
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
			const messages = this.message(entry.message, timestamp, {}, renderers);
			if (cacheMissNotice) {
				messages.push({ role: "notice", ...cacheMissNotice, timestamp });
			}
			return messages;
		}
		if (entry.type === "custom_message" && entry.display) {
			return [
				customMessageInput(
					{
						role: "custom",
						customType: entry.customType,
						content: entry.content,
						display: entry.display,
						details: entry.details,
						// `SessionEntryBase.timestamp` is an ISO string; `CustomMessage.timestamp`
						// (what a `MessageRenderer` expects) is the epoch-ms form the live event
						// path already carries — reconstructed here for the loaded-from-disk path.
						timestamp: timestamp.getTime(),
					},
					timestamp,
					renderers?.renderMessage,
				),
			];
		}
		if (entry.type === "custom") {
			return this.customEntry(entry, timestamp, renderers);
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

	/**
	 * A `CustomEntry` (`pi.appendEntry`) — never sent to the model, and shown
	 * only when the extension registered an `EntryRenderer` for its
	 * `customType` (matching the real interactive mode's `addCustomEntryToChat`:
	 * no renderer, or a renderer that returns `undefined`, means nothing is
	 * added to the transcript at all — see `CustomRendererHost`'s doc comment).
	 * A renderer that throws still surfaces, as a visible error line, the way
	 * `CustomEntryComponent` shows it.
	 */
	customEntry(
		entry: CustomEntry,
		timestamp: Date,
		renderers?: TranscriptCustomRenderers,
	): TranscriptMessageInput[] {
		const outcome = renderers?.renderEntry(entry);
		if (!outcome) return [];
		if (!outcome.ok) {
			return [
				{
					role: "custom",
					text: "",
					timestamp,
					meta: entry.customType,
					customRenderError: `[${entry.customType}] renderer failed: ${outcome.error}`,
				},
			];
		}
		return [
			{
				role: "custom",
				text: "",
				timestamp,
				meta: entry.customType,
				customRenderHtml: outcome.lines,
			},
		];
	}

	message(
		message: AgentMessage,
		timestamp: Date,
		options: { includeAssistantError?: boolean } = {},
		renderers?: TranscriptCustomRenderers,
	): TranscriptMessageInput[] {
		switch (message.role) {
			case "system":
				return [];
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
				// A canonical abort surfaces either as its own dedicated stop reason
				// (the common case — a user hitting stop mid-stream) or, for some
				// providers, as an `"error"` stop reason whose message just says the
				// request was aborted (round-4 O6).
				const aborted =
					message.stopReason === "aborted" ||
					(message.stopReason === "error" &&
						isAbortErrorMessage(message.errorMessage));
				if (
					options.includeAssistantError !== false &&
					message.stopReason === "error" &&
					!aborted
				) {
					messages.push({
						role: "system",
						text: formatProviderErrorMessage(message.errorMessage),
						timestamp,
						state: "error",
					});
				} else if (aborted) {
					// A canonical abort isn't a provider error (the branch above stays
					// silent for it), but the reply it cut off still deserves a visible,
					// muted marker instead of just trailing off (round-4 O6). Mirrors
					// `session-event-reducer.ts`'s live-streaming equivalent.
					// A stop during thinking leaves only the thought to carry the marker.
					const last = messages.at(-1);
					if (last?.role === "assistant" || last?.role === "thought")
						last.meta = "Stopped";
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
					? [customMessageInput(message, timestamp, renderers?.renderMessage)]
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
	attachments?: TranscriptMessageInput["attachments"],
): TranscriptMessageInput[] {
	const skill = parseSkillBlock(text);
	if (!skill) {
		const message: TranscriptMessageInput = { role: "user", text, timestamp };
		if (attachments?.length) message.attachments = attachments;
		return [message];
	}
	const messages: TranscriptMessageInput[] = [
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
): TranscriptMessageInput["attachments"] {
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
	const attachments: NonNullable<TranscriptMessageInput["attachments"]> = paths.map(
		(path) => {
			const name = attachmentDisplayName(path);
			const image = isImageFileName(name) ? images[imageIndex++] : undefined;
			const attachment: NonNullable<TranscriptMessageInput["attachments"]>[number] =
				{
					name,
					path,
					mimeType: image?.mimeType ?? mimeTypeFromName(name),
				};
			if (image) attachment.image = image;
			return attachment;
		},
	);
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
): TranscriptMessageInput {
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
): TranscriptMessageInput[] {
	if (!Array.isArray(content))
		return [{ role: "assistant", text: contentToText(content), timestamp }];
	const messages: TranscriptMessageInput[] = [];
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
