export type TranscriptMessageRole =
	| "user"
	| "assistant"
	| "system"
	| "notice"
	| "tool"
	| "thought"
	| "compaction"
	| "summary"
	| "skill"
	| "custom";

export type TranscriptMessageTitlePart = {
	text: string;
	tone?: "default" | "accent" | "warning" | "muted";
	mono?: boolean;
	highlight?: "bash";
};

export type TranscriptMessageAttachment = {
	name: string;
	path?: string;
	mimeType?: string;
	image?: { data?: string; url?: string; mimeType: string };
};

export type TranscriptMessage = {
	id: string;
	role: TranscriptMessageRole;
	text: string;
	attachments?: TranscriptMessageAttachment[];
	timestamp: Date;
	title?: string;
	titleParts?: TranscriptMessageTitlePart[];
	meta?: string;
	state?: "running" | "success" | "error";
	format?: "pre" | "diff" | "code" | "output";
	/**
	 * Severity for a `role: "notice"` message (an extension's `ctx.ui.notify()`,
	 * or a pi-ui system notice). Defaults to `"warning"` when omitted, matching
	 * every notice appended before this field existed. `renderSystemMessage`
	 * uses it to give each level its own status-dot color and prefix instead of
	 * labelling every notice "Warning:" (see r1-audit #24).
	 */
	noticeTone?: "info" | "warning" | "error";
	/**
	 * Generic collapsible payload for `role: "custom"` messages (an extension's
	 * `pi.sendMessage`/`pi.appendEntry` `details`/`data`), pre-formatted as text by the
	 * caller (see `tool-presentation.ts`'s `summarizeValue`). Never LLM context.
	 */
	details?: string;
	/**
	 * Pre-rendered HTML lines from an extension's `pi.registerMessageRenderer`/
	 * `registerEntryRenderer` (a `pi-tui` `Component`), produced by
	 * `CustomRendererHost` through the same ANSI→HTML pipeline
	 * `TerminalSurfaceController` uses for `custom()` overlays. Already safe,
	 * pre-escaped HTML (see `ansiLineToHtml`) — never raw ANSI or untrusted
	 * markup. `role: "custom"` only; when present it renders instead of
	 * `text`'s markdown (round-7 "custom message + entry renderers").
	 */
	customRenderHtml?: readonly string[];
	/**
	 * Set only when a `registerEntryRenderer` (never a message renderer — see
	 * `CustomRendererHost`'s doc comment) throws. Mirrors the real interactive
	 * mode's `CustomEntryComponent`: a visible `"[type] renderer failed: …"`
	 * line instead of silently falling back, since a `CustomEntry` has no
	 * text/markdown fallback to fall back to.
	 */
	customRenderError?: string;
};

export type TranscriptMessageOptions = Pick<
	TranscriptMessage,
	| "title"
	| "titleParts"
	| "meta"
	| "state"
	| "format"
	| "attachments"
	| "noticeTone"
	| "details"
	| "customRenderHtml"
	| "customRenderError"
>;

export type TranscriptMessageInput = Omit<TranscriptMessage, "id">;

export type TranscriptEmptyHint = {
	keys: string;
	description: string;
};

export type TranscriptSnapshot = {
	messageSeq: number;
	activeAssistantId: string | undefined;
	activeThoughtId: string | undefined;
	transcriptMessages: TranscriptMessage[];
	visibleMessageStart: number;
	emptyChatHint: TranscriptEmptyHint;
	activityText: string | undefined;
	queuedSteeringMessages: string[];
	queuedFollowUpMessages: string[];
};

const initialVisibleMessageCount = 30;
const olderMessageBatchSize = 30;
const maximumVisibleMessageCount = 100;

/** Renderer-independent, authoritative transcript state. */
export type FinishedAssistantIds = {
	assistantId?: string;
	thoughtId?: string;
};

export class TranscriptState {
	private messageSeq = 0;
	private activeAssistantId: string | undefined;
	private activeThoughtId: string | undefined;
	private transcriptMessages: TranscriptMessage[] = [];
	private messageIndexById = new Map<string, number>();
	private visibleMessageStart = 0;
	emptyChatHint: TranscriptEmptyHint;
	activityText: string | undefined;
	queuedSteeringMessages: string[] = [];
	queuedFollowUpMessages: string[] = [];

	constructor(emptyChatHint: TranscriptEmptyHint) {
		this.emptyChatHint = { ...emptyChatHint };
	}

	get hasOlderMessages(): boolean {
		return this.visibleMessageStart > 0;
	}

	get activeAssistantMessageId(): string | undefined {
		return this.activeAssistantId;
	}

	get activeThoughtMessageId(): string | undefined {
		return this.activeThoughtId;
	}

	get messages(): readonly TranscriptMessage[] {
		return this.transcriptMessages.slice(this.visibleMessageStart);
	}

	get allMessages(): readonly TranscriptMessage[] {
		return this.transcriptMessages;
	}

	getMessage(id: string): TranscriptMessage | undefined {
		const index = this.messageIndexById.get(id);
		return index === undefined ? undefined : this.transcriptMessages[index];
	}

	getMessageIndex(id: string): number | undefined {
		return this.messageIndexById.get(id);
	}

	appendMessage(
		role: TranscriptMessageRole,
		text: string,
		options: TranscriptMessageOptions = {},
	): string {
		this.messageSeq += 1;
		const id = `m-${this.messageSeq}`;
		this.transcriptMessages.push({
			id,
			role,
			text,
			timestamp: new Date(),
			...options,
		});
		this.messageIndexById.set(id, this.transcriptMessages.length - 1);
		if (role === "assistant") this.activeAssistantId = id;
		if (role === "thought") this.activeThoughtId = id;
		return id;
	}

	updateMessage(id: string, patch: Partial<Omit<TranscriptMessage, "id">>): boolean {
		const message = this.getMessage(id);
		if (!message) return false;
		Object.assign(message, patch);
		return true;
	}

	appendThoughtDelta(delta: string): string {
		const message = this.activeThoughtId
			? this.getMessage(this.activeThoughtId)
			: undefined;
		if (!message) return this.appendMessage("thought", delta);
		message.text += delta;
		return message.id;
	}

	appendAssistantDelta(delta: string): string {
		this.activeThoughtId = undefined;
		const message = this.activeAssistantId
			? this.getMessage(this.activeAssistantId)
			: undefined;
		if (!message) return this.appendMessage("assistant", delta);
		message.text += delta;
		return message.id;
	}

	finishAssistant(): FinishedAssistantIds {
		const result = {
			assistantId: this.activeAssistantId,
			thoughtId: this.activeThoughtId,
		};
		this.activeAssistantId = undefined;
		this.activeThoughtId = undefined;
		return result;
	}

	setActivityText(activityText: string | undefined): void {
		this.activityText = activityText;
	}

	setQueuedMessages(steering: readonly string[], followUp: readonly string[]): void {
		this.queuedSteeringMessages = [...steering];
		this.queuedFollowUpMessages = [...followUp];
	}

	snapshot(): TranscriptSnapshot {
		return {
			messageSeq: this.messageSeq,
			activeAssistantId: this.activeAssistantId,
			activeThoughtId: this.activeThoughtId,
			transcriptMessages: this.transcriptMessages.map(cloneMessage),
			visibleMessageStart: this.visibleMessageStart,
			emptyChatHint: { ...this.emptyChatHint },
			activityText: this.activityText,
			queuedSteeringMessages: [...this.queuedSteeringMessages],
			queuedFollowUpMessages: [...this.queuedFollowUpMessages],
		};
	}

	restore(snapshot: TranscriptSnapshot): void {
		this.messageSeq = snapshot.messageSeq;
		this.activeAssistantId = snapshot.activeAssistantId;
		this.activeThoughtId = snapshot.activeThoughtId;
		this.transcriptMessages = snapshot.transcriptMessages.map(cloneMessage);
		this.rebuildMessageIndex();
		this.visibleMessageStart = snapshot.visibleMessageStart;
		this.emptyChatHint = { ...snapshot.emptyChatHint };
		this.activityText = snapshot.activityText;
		this.queuedSteeringMessages = [...snapshot.queuedSteeringMessages];
		this.queuedFollowUpMessages = [...snapshot.queuedFollowUpMessages];
	}

	reset(emptyChatHint?: TranscriptEmptyHint): void {
		this.transcriptMessages = [];
		this.messageIndexById.clear();
		this.visibleMessageStart = 0;
		this.activeAssistantId = undefined;
		this.activeThoughtId = undefined;
		if (emptyChatHint) this.emptyChatHint = { ...emptyChatHint };
	}

	replaceMessages(
		messages: readonly TranscriptMessageInput[],
		emptyChatHint?: TranscriptEmptyHint,
	): void {
		this.activeAssistantId = undefined;
		this.activeThoughtId = undefined;
		if (emptyChatHint) this.emptyChatHint = { ...emptyChatHint };
		this.transcriptMessages = messages.map((message) => {
			this.messageSeq += 1;
			return { ...message, id: `m-${this.messageSeq}` };
		});
		this.rebuildMessageIndex();
		this.visibleMessageStart = Math.max(
			0,
			this.transcriptMessages.length - initialVisibleMessageCount,
		);
	}

	showRecentMessages(): boolean {
		const nextStart = Math.max(
			0,
			this.transcriptMessages.length - initialVisibleMessageCount,
		);
		if (nextStart <= this.visibleMessageStart) return false;
		this.visibleMessageStart = nextStart;
		return true;
	}

	loadOlderMessages(): readonly TranscriptMessage[] {
		if (!this.hasOlderMessages) return [];
		const previousStart = this.visibleMessageStart;
		this.visibleMessageStart = Math.max(0, previousStart - olderMessageBatchSize);
		return this.transcriptMessages.slice(this.visibleMessageStart, previousStart);
	}

	trimOldMessages(): readonly string[] {
		const nextStart = Math.max(
			this.visibleMessageStart,
			this.transcriptMessages.length - maximumVisibleMessageCount,
		);
		const ids = this.transcriptMessages
			.slice(this.visibleMessageStart, nextStart)
			.map((message) => message.id);
		this.visibleMessageStart = nextStart;
		return ids;
	}

	private rebuildMessageIndex(): void {
		this.messageIndexById = new Map(
			this.transcriptMessages.map((message, index) => [message.id, index]),
		);
	}
}

function cloneMessage(message: TranscriptMessage): TranscriptMessage {
	return {
		...message,
		attachments: message.attachments?.map((attachment) => ({
			...attachment,
			image: attachment.image ? { ...attachment.image } : undefined,
		})),
		timestamp: new Date(message.timestamp),
		titleParts: message.titleParts?.map((part) => ({ ...part })),
	};
}
