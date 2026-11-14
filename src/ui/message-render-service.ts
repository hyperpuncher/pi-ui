import { codeThemeKey } from "#src/pierre-theme.ts";
import type { AppStateSnapshot, AppStore } from "#src/state/app-store.ts";
import type {
	TranscriptMessage,
	TranscriptMessageAttachment,
} from "#src/state/transcript-state.ts";
import { renderPierreCode, renderPierreDiff } from "#src/ui/diffs.ts";
import {
	releaseMarkdownStreamingState,
	renderCodeFinal,
	renderMarkdownFinal,
	renderMarkdownStreaming,
} from "#src/ui/markdown.tsx";
import { renderMessage, renderMessages } from "#src/ui/messages.tsx";
import { BoundedCache, deleteStringKeysWithPrefix } from "#src/ui/render-cache.ts";
import type { AppMessage } from "#src/ui/render-state.ts";
import { probeImageDimensions } from "#src/utils/image-dimensions.ts";

export type MessageRenderServiceOptions = {
	registerImage?: (image: { data: string; mimeType: string }) => string;
	clearImages?: () => void;
};

const markdownRoles = new Set<AppMessage["role"]>([
	"assistant",
	"thought",
	"compaction",
	"summary",
	"skill",
]);

// Tool output repeats across restores; bound it like the Markdown cache.
const toolOutputCache = new BoundedCache<string, string>(500, {
	maxWeight: 16 * 1024 * 1024,
	weight: (key, value) => 2 * (key.length + value.length),
});

function renderToolOutput(message: TranscriptMessage): string | undefined {
	const { format, text } = message;
	if ((format !== "diff" && format !== "code") || !text.trim()) return undefined;
	if (format === "code" && message.state === "running") return undefined;
	const key = `${codeThemeKey()}\0${format}\0${text}`;
	const cached = toolOutputCache.get(key);
	if (cached !== undefined) return cached;
	const html =
		format === "diff"
			? (renderPierreDiff(text) ?? renderCodeFinal(text, "diff", { chrome: false }))
			: renderPierreCode(text, "bash", { disableLineNumbers: true });
	if (html !== undefined) toolOutputCache.set(key, html);
	return html;
}

function formatActivityDuration(milliseconds: number): string {
	const totalSeconds = Math.max(1, Math.round(milliseconds / 1000));
	if (totalSeconds < 60) return `${totalSeconds}s`;
	const minutes = Math.floor(totalSeconds / 60);
	const seconds = totalSeconds % 60;
	return seconds === 0 ? `${minutes}m` : `${minutes}m ${seconds}s`;
}

/** Projects transcript messages to HTML and patches the ones changed since the last frame. */
export class MessageRenderService {
	private readonly imageUrls = new Map<
		string,
		{ data: string; url: string; width?: number; height?: number }
	>();
	private readonly dirtyIds = new Set<string>();

	constructor(
		private readonly store: AppStore,
		private readonly patchMessage: (html: string, selector: string) => void,
		private readonly options: MessageRenderServiceOptions = {},
		private readonly frames = { schedule: () => {}, flush: () => {} },
	) {}

	projectMessages(messages: readonly TranscriptMessage[]): AppMessage[] {
		return messages.map((message) => this.project(message));
	}
	get compactTools(): boolean {
		return this.store.minimalMode || this.store.toolOutputHidden;
	}
	renderTranscript(snapshot: AppStateSnapshot): string {
		return renderMessages(
			this.projectMessages(snapshot.messages),
			snapshot.emptyChatHint,
			snapshot.hasOlderMessages,
			snapshot.sessions,
			snapshot.models.some((model) => model.configured),
			snapshot.sessionCatalogLoading,
			snapshot.minimalMode || snapshot.toolOutputHidden,
		);
	}
	renderMessageElement(id: string): string | undefined {
		const message = this.store.transcript.getMessage(id);
		if (!message) return undefined;
		return renderMessage(this.project(message), this.compactTools);
	}
	messageUpdated(id: string): void {
		releaseMarkdownStreamingState(id);
		this.dirtyIds.add(id);
		this.frames.schedule();
	}
	streamingMessageChanged(): void {
		for (const id of this.streamingIds()) this.dirtyIds.add(id);
		this.frames.schedule();
	}
	assistantFinished(ids: { assistantId?: string; thoughtId?: string }): void {
		for (const id of [ids.thoughtId, ids.assistantId]) {
			if (id === undefined) continue;
			releaseMarkdownStreamingState(id);
			this.dirtyIds.add(id);
		}
		this.frames.flush();
	}
	/** Drops message state before the transcript changes wholesale or the theme changes. */
	reset(): void {
		this.dirtyIds.clear();
		for (const message of this.store.transcript.allMessages)
			releaseMarkdownStreamingState(message.id);
		this.imageUrls.clear();
		this.options.clearImages?.();
	}
	dropMessages(ids: readonly string[]): void {
		for (const id of ids) {
			releaseMarkdownStreamingState(id);
			deleteStringKeysWithPrefix(this.imageUrls, `${id}:`);
		}
	}
	/** Renders messages changed since the last frame. The renderer calls this once per frame. */
	patchChangedMessages(transcriptPatched: boolean): void {
		const ids = [...this.dirtyIds];
		this.dirtyIds.clear();
		if (transcriptPatched) return;
		for (const id of ids) {
			const html = this.renderMessageElement(id);
			if (html !== undefined) this.patchMessage(html, `#message-${id}`);
		}
	}
	private streamingIds(): string[] {
		const { activeThoughtMessageId, activeAssistantMessageId } =
			this.store.transcript;
		return [activeThoughtMessageId, activeAssistantMessageId].filter(
			(id): id is string => id !== undefined,
		);
	}
	private renderedHtml(message: TranscriptMessage): string | undefined {
		if (!markdownRoles.has(message.role)) return renderToolOutput(message);
		if (!message.text.trim()) return undefined;
		return this.streamingIds().includes(message.id)
			? renderMarkdownStreaming(message.text, { cacheKey: message.id })
			: renderMarkdownFinal(message.text, { cacheKey: message.id });
	}
	private project(message: TranscriptMessage): AppMessage {
		return {
			...message,
			activitySummary: this.activitySummary(message),
			attachments: message.attachments?.map((attachment, index) =>
				this.projectAttachment(message.id, index, attachment),
			),
			renderedHtml: this.renderedHtml(message),
		};
	}
	private projectAttachment(
		id: string,
		index: number,
		attachment: TranscriptMessageAttachment,
	): TranscriptMessageAttachment {
		const image = attachment.image;
		const registerImage = this.options.registerImage;
		if (!image?.data || !registerImage) return attachment;
		const key = `${id}:${index}`;
		let registered = this.imageUrls.get(key);
		if (!registered || registered.data !== image.data) {
			// Probe the header sync: Bun.Image.metadata is async and this
			// runs inside a sync projection.
			registered = {
				data: image.data,
				url: registerImage({ data: image.data, mimeType: image.mimeType }),
				...probeImageDimensions(image.data),
			};
			this.imageUrls.set(key, registered);
		}
		const renderedImage: NonNullable<TranscriptMessageAttachment["image"]> = {
			mimeType: image.mimeType,
			url: registered.url,
		};
		// A box needs both sides; a lone side reserves nothing.
		if (registered.width !== undefined && registered.height !== undefined) {
			renderedImage.width = registered.width;
			renderedImage.height = registered.height;
		}
		return { ...attachment, image: renderedImage };
	}
	private activitySummary(message: TranscriptMessage): AppMessage["activitySummary"] {
		if (message.role !== "assistant") return undefined;
		const messages = this.store.transcript.allMessages;
		const messageIndex = this.store.transcript.getMessageIndex(message.id);
		if (messageIndex === undefined) return undefined;
		let activityStart = messageIndex;
		let stepCount = 0;
		while (activityStart > 0) {
			const activity = messages[activityStart - 1]!;
			if (activity.role !== "thought" && activity.role !== "tool") break;
			activityStart -= 1;
			if (activity.role === "tool") stepCount += 1;
		}
		if (stepCount === 0) return undefined;
		return {
			stepCount,
			duration: formatActivityDuration(
				message.timestamp.getTime() -
					messages[activityStart]!.timestamp.getTime(),
			),
		};
	}
}
