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
	registerPage?: (html: string) => string;
	clearSessionAssets?: () => void;
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

function isActivityRole(role: TranscriptMessage["role"]): boolean {
	return role === "thought" || role === "tool";
}

function diffChangeCounts(diffText: string) {
	let additions = 0;
	let deletions = 0;
	for (let start = 0; start < diffText.length;) {
		const end = diffText.indexOf("\n", start);
		const lineEnd = end === -1 ? diffText.length : end;
		const first = diffText[start];
		if (first === "+" && !diffText.startsWith("+++", start)) additions += 1;
		else if (first === "-" && !diffText.startsWith("---", start)) deletions += 1;
		start = lineEnd + 1;
	}
	return { additions, deletions };
}

function outputLineCount(text: string): number {
	const trimmed = text.trimEnd();
	if (!trimmed) return 0;
	const firstBreak = trimmed.indexOf("\n");
	const firstLine = firstBreak === -1 ? trimmed : trimmed.slice(0, firstBreak);
	let lines = 1;
	for (let pos = firstBreak; pos !== -1; pos = trimmed.indexOf("\n", pos + 1)) {
		lines += 1;
	}
	const earlier = /^\.\.\. \((\d+) earlier lines\)$/.exec(firstLine);
	return earlier ? Number(earlier[1]) + lines - 1 : lines;
}

function compactToolMeta(message: TranscriptMessage): string | undefined {
	if (message.role !== "tool") return undefined;
	const parts: string[] = [];
	if (message.format === "diff" && message.text.trim()) {
		const { additions, deletions } = diffChangeCounts(message.text);
		const diffParts: string[] = [];
		if (additions > 0) diffParts.push(`+${additions}`);
		if (deletions > 0) diffParts.push(`-${deletions}`);
		if (diffParts.length) parts.push(diffParts.join(" "));
	}
	const nestedCount = message.nestedCalls?.calls.length ?? 0;
	if (nestedCount > 0) {
		parts.push(`${nestedCount} ${nestedCount === 1 ? "call" : "calls"}`);
	}
	const imageCount =
		message.attachments?.filter((attachment) => attachment.image).length ?? 0;
	if (imageCount > 0) {
		parts.push(`${imageCount} ${imageCount === 1 ? "image" : "images"}`);
	}
	if (message.format !== "diff" && message.text.trim()) {
		const lines = outputLineCount(message.text);
		if (lines > 1) parts.push(`${lines} lines`);
	}
	return parts.length ? parts.join(" · ") : undefined;
}

/** Projects transcript messages to HTML and patches the ones changed since the last frame. */
export class MessageRenderService {
	private readonly imageUrls = new Map<
		string,
		{ data: string; url: string; width?: number; height?: number }
	>();
	private readonly dirtyIds = new Set<string>();
	private readonly toolExpansionOverrides = new Map<string, boolean>();
	private readonly expandedActivityIds = new Set<string>();

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
			{
				thinkingHidden: snapshot.thinkingHidden,
				minimalMode: snapshot.minimalMode,
			},
		);
	}
	renderMessageElement(id: string): string | undefined {
		const message = this.store.transcript.getMessage(id);
		if (!message) return undefined;
		return renderMessage(this.project(message), this.compactTools, {
			thinkingHidden: this.store.thinkingHidden,
			minimalMode: this.store.minimalMode,
		});
	}
	clearExpansions(): void {
		this.toolExpansionOverrides.clear();
		this.expandedActivityIds.clear();
	}
	toggleMessageExpand(id: string): void {
		const message = this.store.transcript.getMessage(id);
		if (!message) return;
		if (message.role === "assistant") {
			if (this.expandedActivityIds.has(id)) this.expandedActivityIds.delete(id);
			else this.expandedActivityIds.add(id);
			this.dirtyIds.add(id);
			for (const activityId of this.activityMessageIds(id)) {
				this.dirtyIds.add(activityId);
			}
			this.frames.flush();
			return;
		}
		if (message.role === "tool") {
			this.toolExpansionOverrides.set(id, !this.isToolExpanded(message));
			this.dirtyIds.add(id);
			this.frames.flush();
		}
	}
	messageUpdated(id: string): void {
		releaseMarkdownStreamingState(id);
		this.dirtyIds.add(id);
		this.frames.schedule();
	}
	streamingMessageChanged(id: string): void {
		this.dirtyIds.add(id);
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
		this.clearExpansions();
		for (const message of this.store.transcript.allMessages)
			releaseMarkdownStreamingState(message.id);
		this.imageUrls.clear();
		this.options.clearSessionAssets?.();
	}
	dropMessages(ids: readonly string[]): void {
		for (const id of ids) {
			releaseMarkdownStreamingState(id);
			deleteStringKeysWithPrefix(this.imageUrls, `${id}:`);
			this.toolExpansionOverrides.delete(id);
			this.expandedActivityIds.delete(id);
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
	private isToolExpanded(message: TranscriptMessage): boolean {
		if (!this.compactTools) return true;
		const override = this.toolExpansionOverrides.get(message.id);
		if (override !== undefined) return override;
		return !this.store.minimalMode && message.state === "error";
	}
	private isMinimalExpanded(index: number | undefined): boolean {
		if (
			index === undefined ||
			!this.store.minimalMode ||
			this.expandedActivityIds.size === 0
		) {
			return false;
		}
		const messages = this.store.transcript.allMessages;
		let cursor = index + 1;
		while (cursor < messages.length && isActivityRole(messages[cursor]!.role)) {
			cursor += 1;
		}
		const next = messages[cursor];
		return next?.role === "assistant" && this.expandedActivityIds.has(next.id);
	}
	private activityMessageIds(assistantId: string): string[] {
		const messages = this.store.transcript.allMessages;
		const messageIndex = this.store.transcript.getMessageIndex(assistantId);
		if (messageIndex === undefined) return [];
		const ids: string[] = [];
		for (
			let cursor = messageIndex - 1;
			cursor >= 0 && isActivityRole(messages[cursor]!.role);
			cursor -= 1
		) {
			ids.push(messages[cursor]!.id);
		}
		return ids;
	}
	private activityStep(
		message: TranscriptMessage,
		index: number | undefined,
	): number | undefined {
		if (index === undefined || !this.store.minimalMode) return undefined;
		if (!isActivityRole(message.role)) return undefined;
		const messages = this.store.transcript.allMessages;
		let stepCount = message.role === "tool" ? 1 : 0;
		for (
			let cursor = index - 1;
			cursor >= 0 && isActivityRole(messages[cursor]!.role);
			cursor -= 1
		) {
			if (messages[cursor]!.role === "tool") stepCount += 1;
		}
		return stepCount > 0 ? stepCount : undefined;
	}
	private thoughtDuration(
		message: TranscriptMessage,
		index: number | undefined,
	): string | undefined {
		if (index === undefined || message.role !== "thought") return undefined;
		if (this.store.transcript.activeThoughtMessageId === message.id) return undefined;
		const next = this.store.transcript.allMessages[index + 1];
		if (!next || next.role === "user") return undefined;
		const elapsedMs = next.timestamp.getTime() - message.timestamp.getTime();
		return elapsedMs >= 1000 ? formatActivityDuration(elapsedMs) : undefined;
	}
	private renderedHtml(
		message: TranscriptMessage,
		minimalExpanded: boolean,
		toolExpanded: boolean,
	): string | undefined {
		if (!markdownRoles.has(message.role)) {
			if (this.compactTools && !toolExpanded) return undefined;
			return renderToolOutput(message);
		}
		if (message.role === "thought" && this.store.minimalMode && !minimalExpanded) {
			return undefined;
		}
		if (!message.text.trim()) return undefined;
		return this.streamingIds().includes(message.id)
			? renderMarkdownStreaming(message.text, { cacheKey: message.id })
			: renderMarkdownFinal(message.text, { cacheKey: message.id });
	}
	private project(message: TranscriptMessage): AppMessage {
		const index = this.store.transcript.getMessageIndex(message.id);
		const minimalExpanded =
			isActivityRole(message.role) && this.isMinimalExpanded(index);
		const toolExpanded =
			message.role === "tool" && this.compactTools && this.isToolExpanded(message);
		return {
			...message,
			activitySummary: this.activitySummary(message, index),
			activityStep: this.activityStep(message, index),
			streaming:
				message.role === "thought" &&
				this.store.transcript.activeThoughtMessageId === message.id,
			thoughtDuration: this.thoughtDuration(message, index),
			minimalExpanded: minimalExpanded || undefined,
			toolExpanded: toolExpanded || undefined,
			compactMeta:
				message.role === "tool" && this.compactTools && !toolExpanded
					? compactToolMeta(message)
					: undefined,
			attachments: message.attachments?.map((attachment, index) =>
				this.projectAttachment(message.id, index, attachment),
			),
			renderedHtml: this.renderedHtml(message, minimalExpanded, toolExpanded),
			pageUrl: message.page && this.options.registerPage?.(message.page.html),
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
	private activitySummary(
		message: TranscriptMessage,
		messageIndex: number | undefined,
	): AppMessage["activitySummary"] {
		if (messageIndex === undefined || message.role !== "assistant") return undefined;
		const messages = this.store.transcript.allMessages;
		let activityStart = messageIndex;
		let stepCount = 0;
		let thoughtCount = 0;
		while (activityStart > 0 && isActivityRole(messages[activityStart - 1]!.role)) {
			activityStart -= 1;
			if (messages[activityStart]!.role === "tool") stepCount += 1;
			else thoughtCount += 1;
		}
		if (stepCount === 0 && thoughtCount === 0) return undefined;
		const elapsedMs =
			message.timestamp.getTime() - messages[activityStart]!.timestamp.getTime();
		const duration =
			stepCount > 0
				? formatActivityDuration(elapsedMs)
				: elapsedMs >= 1000
					? formatActivityDuration(elapsedMs)
					: undefined;
		return {
			stepCount,
			thoughtCount,
			duration,
			expanded: this.expandedActivityIds.has(message.id),
		};
	}
}
