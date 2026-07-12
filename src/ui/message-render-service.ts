import { sessionPerformance } from "../perf/session-performance.ts";
import type { AppMessage, AppStore } from "../state/app-store.ts";
import { shouldDeferEnhancement } from "../state/enhancement-policy.ts";
import { EnhancementQueue } from "../state/enhancement-queue.ts";
import { StreamingFrameScheduler } from "../state/streaming-frame-scheduler.ts";
import type { TranscriptMessage } from "../state/transcript-state.ts";
import { renderPierreCode, renderPierreDiff } from "./diffs.ts";
import {
	releaseMarkdownStreamingState,
	renderCodeFinal,
	renderMarkdownFinal,
	renderMarkdownStreaming,
} from "./markdown.tsx";
import { renderMessage, renderMessages } from "./messages.tsx";

type MessagePresentation = Pick<
	AppMessage,
	"renderedHtml" | "presentationState" | "presentationVersion"
>;
type EnhancementKind = "markdown" | "code" | "diff";
export type MessageRenderServiceOptions = {
	enhancementConcurrency?: number;
	renderMarkdownFinal?: (text: string) => Promise<string>;
	renderCode?: (text: string, language: string) => Promise<string>;
	renderDiff?: (text: string) => Promise<string | undefined>;
};

const markdownRoles = new Set<AppMessage["role"]>([
	"assistant",
	"thought",
	"compaction",
	"skill",
]);
function rendersMarkdown(role: AppMessage["role"]): boolean {
	return markdownRoles.has(role);
}
function enhancementKind(message: AppMessage): EnhancementKind | undefined {
	if (rendersMarkdown(message.role)) return "markdown";
	if (message.role !== "tool") return undefined;
	if (message.format === "diff") return "diff";
	if (message.format === "code") return "code";
}
function unique(values: readonly (string | undefined)[]): string[] {
	return [...new Set(values.filter((value): value is string => value !== undefined))];
}

/** Owns message presentation caches, frame scheduling, and bounded enhancement work. */
export class MessageRenderService {
	private readonly presentation = new Map<string, MessagePresentation>();
	private readonly queue: EnhancementQueue;
	private readonly streaming: StreamingFrameScheduler<readonly string[]>;
	private generation = 0;
	private readonly renderMarkdownEnhancement: (text: string) => Promise<string>;
	private readonly renderCodeEnhancement: (
		text: string,
		language: string,
	) => Promise<string>;
	private readonly renderDiffEnhancement: (text: string) => Promise<string | undefined>;

	constructor(
		private readonly store: AppStore,
		private readonly patchMessage: (html: string, selector: string) => void,
		private readonly deferEnhancement: (id: string) => void,
		options: MessageRenderServiceOptions = {},
	) {
		this.queue = new EnhancementQueue(options.enhancementConcurrency ?? 2);
		this.renderMarkdownEnhancement =
			options.renderMarkdownFinal ?? renderMarkdownFinal;
		this.renderCodeEnhancement =
			options.renderCode ??
			((text, language) =>
				renderPierreCode(text, language, { disableLineNumbers: true }));
		this.renderDiffEnhancement = options.renderDiff ?? renderPierreDiff;
		this.streaming = new StreamingFrameScheduler((ids) => {
			for (const id of ids) this.patchStreaming(id);
		});
	}

	projectMessages(messages: readonly TranscriptMessage[]): AppMessage[] {
		return messages.map((message) => ({ ...message, ...this.ensure(message.id) }));
	}
	renderMessagesElement(): string {
		return renderMessages(
			this.store.messages,
			this.store.emptyChatHint,
			this.store.hasOlderMessages,
			this.store.sessions,
			this.store.sessionTransition.status !== "idle",
		);
	}
	messageAppended(id: string): void {
		const message = this.store.transcript.getMessage(id);
		if (!message) return;
		this.presentation.set(id, {
			renderedHtml:
				rendersMarkdown(message.role) && message.text.trim()
					? renderMarkdownStreaming(message.text, { cacheKey: id })
					: undefined,
			presentationState: rendersMarkdown(message.role) ? "streaming" : "plain",
			presentationVersion: 0,
		});
		if (message.role === "tool") this.deferEnhancement(id);
	}
	messageUpdated(id: string): void {
		releaseMarkdownStreamingState(id);
		const value = this.ensure(id);
		value.renderedHtml = undefined;
		value.presentationState = "plain";
		value.presentationVersion += 1;
		this.deferEnhancement(id);
	}
	streamingMessageStarted(id: string): void {
		this.initializeStreaming(id);
	}
	streamingMessageChanged(): void {
		for (const id of this.streamingIds()) this.ensure(id).presentationVersion += 1;
		this.streaming.schedule(this.streamingIds());
	}
	assistantFinished(ids: { assistantId?: string; thoughtId?: string }): void {
		this.streaming.flush(unique([ids.thoughtId, ids.assistantId]));
		for (const id of unique([ids.thoughtId, ids.assistantId]))
			this.deferEnhancement(id);
	}
	transcriptReplacing(): void {
		this.streaming.clear();
		this.generation += 1;
		this.queue.cancelAll();
		for (const message of this.store.transcript.allMessages)
			releaseMarkdownStreamingState(message.id);
		this.presentation.clear();
	}
	transcriptReplaced(
		activeIds: readonly (string | undefined)[],
		enhancementIds: readonly string[],
	): void {
		for (const id of activeIds) if (id) this.initializeStreaming(id);
		for (const id of enhancementIds.toReversed()) this.deferEnhancement(id);
	}
	setDisplayRefreshHz(hz: number): boolean {
		return this.streaming.setDisplayHz(hz);
	}
	enhanceMessage(id: string): boolean {
		const message = this.store.transcript.getMessage(id);
		if (!message || this.ensure(id).presentationState !== "deferred") return false;
		this.enqueueEnhancement(id, true);
		return true;
	}
	enqueueEnhancement(id: string, force = false): void {
		const message = this.store.transcript.getMessage(id);
		const projected = message ? this.project(message) : undefined;
		const kind = projected ? enhancementKind(projected) : undefined;
		const value = message ? this.ensure(id) : undefined;
		if (
			!message ||
			!kind ||
			!value ||
			(kind === "markdown" && this.streamingIds().includes(id)) ||
			!message.text.trim() ||
			value.presentationState === "enhancing" ||
			value.presentationState === "final" ||
			(value.presentationState === "deferred" && !force)
		)
			return;
		if (!force && shouldDeferEnhancement(kind, message.text)) {
			value.presentationState = "deferred";
			this.broadcast(message);
			return;
		}
		const generation = this.generation;
		const text = message.text;
		const format = message.format;
		const version = value.presentationVersion;
		value.presentationState = "enhancing";
		this.queue.enqueue({
			key: `${generation}:${id}:${version}:${kind}`,
			priority: this.store.transcript.allMessages.indexOf(message),
			run: async (signal) => {
				const html = await this.renderEnhancement(kind, text);
				if (signal.aborted) return;
				const current = this.store.transcript.getMessage(id);
				const currentValue = this.ensure(id);
				if (
					generation !== this.generation ||
					!current ||
					current.text !== text ||
					current.format !== format ||
					currentValue.presentationVersion !== version
				)
					return;
				currentValue.renderedHtml = html;
				currentValue.presentationState = "final";
				releaseMarkdownStreamingState(id);
				this.broadcast(current);
			},
			onCancel: () => releaseMarkdownStreamingState(id),
			onError: (error) => {
				const current = this.store.transcript.getMessage(id);
				const currentValue = this.ensure(id);
				if (
					generation === this.generation &&
					current?.text === text &&
					current.format === format &&
					currentValue.presentationVersion === version
				) {
					currentValue.presentationState = "plain";
					currentValue.renderedHtml = undefined;
					releaseMarkdownStreamingState(id);
				}
				console.warn(`Failed to enhance message ${id}`, error);
			},
		});
	}
	private streamingIds(): string[] {
		return unique([
			this.store.transcript.activeThoughtMessageId,
			this.store.transcript.activeAssistantMessageId,
		]);
	}
	private initializeStreaming(id: string): void {
		const message = this.store.transcript.getMessage(id);
		if (!message) return;
		this.presentation.set(id, {
			renderedHtml: message.text.trim()
				? renderMarkdownStreaming(message.text, { cacheKey: id })
				: undefined,
			presentationState: "streaming",
			presentationVersion: 0,
		});
	}
	private patchStreaming(id: string): void {
		const message = this.store.transcript.getMessage(id);
		if (!message || !rendersMarkdown(message.role) || !message.text.trim()) return;
		const value = this.ensure(id);
		value.renderedHtml = renderMarkdownStreaming(message.text, { cacheKey: id });
		value.presentationState = "streaming";
		this.broadcast(message);
	}
	private project(message: TranscriptMessage): AppMessage {
		return { ...message, ...this.ensure(message.id) };
	}
	private broadcast(message: TranscriptMessage): void {
		const projected = this.project(message);
		this.patchMessage(renderMessage(projected), `[data-message-id="${message.id}"]`);
	}
	private ensure(id: string): MessagePresentation {
		let value = this.presentation.get(id);
		if (!value) {
			value = { presentationState: "plain", presentationVersion: 0 };
			this.presentation.set(id, value);
		}
		return value;
	}
	private async renderEnhancement(
		kind: EnhancementKind,
		text: string,
	): Promise<string> {
		if (kind === "markdown")
			return await sessionPerformance.measure("markdownEnhancement", () =>
				this.renderMarkdownEnhancement(text),
			);
		const end = sessionPerformance.startSpan("toolEnhancement");
		try {
			if (kind === "diff")
				return (
					(await this.renderDiffEnhancement(text)) ??
					(await renderCodeFinal(text, "diff", { chrome: false }))
				);
			return await this.renderCodeEnhancement(text, "bash");
		} finally {
			end();
		}
	}
}
