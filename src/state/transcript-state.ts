export type TranscriptMessageRole =
	| "user"
	| "assistant"
	| "system"
	| "notice"
	| "tool"
	| "thought"
	| "compaction"
	| "skill";

export type TranscriptMessageTitlePart = {
	text: string;
	tone?: "default" | "accent" | "warning" | "muted";
	mono?: boolean;
	highlight?: "bash";
};

export type TranscriptMessage = {
	id: string;
	role: TranscriptMessageRole;
	text: string;
	timestamp: Date;
	title?: string;
	titleParts?: TranscriptMessageTitlePart[];
	meta?: string;
	state?: "running" | "success" | "error";
	format?: "pre" | "diff" | "code" | "output";
};

export type TranscriptMessageOptions = Pick<
	TranscriptMessage,
	"title" | "titleParts" | "meta" | "state" | "format"
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

export const transcriptMessagePageSize = 100;

/** Renderer-independent, authoritative transcript state. */
export class TranscriptState {
	private messageSeq = 0;
	private activeAssistantId: string | undefined;
	private activeThoughtId: string | undefined;
	private transcriptMessages: TranscriptMessage[] = [];
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
		return this.transcriptMessages.find((message) => message.id === id);
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

	finishAssistant(): { assistantId?: string; thoughtId?: string } {
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
		this.visibleMessageStart = snapshot.visibleMessageStart;
		this.emptyChatHint = { ...snapshot.emptyChatHint };
		this.activityText = snapshot.activityText;
		this.queuedSteeringMessages = [...snapshot.queuedSteeringMessages];
		this.queuedFollowUpMessages = [...snapshot.queuedFollowUpMessages];
	}

	reset(emptyChatHint?: TranscriptEmptyHint): void {
		this.transcriptMessages = [];
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
		this.visibleMessageStart = Math.max(
			0,
			this.transcriptMessages.length - transcriptMessagePageSize,
		);
	}

	loadOlderMessages(): readonly string[] {
		if (!this.hasOlderMessages) return [];
		const previousStart = this.visibleMessageStart;
		this.visibleMessageStart = Math.max(
			0,
			this.visibleMessageStart - transcriptMessagePageSize,
		);
		return this.transcriptMessages
			.slice(this.visibleMessageStart, previousStart)
			.map((message) => message.id);
	}
}

function cloneMessage(message: TranscriptMessage): TranscriptMessage {
	return {
		...message,
		timestamp: new Date(message.timestamp),
		titleParts: message.titleParts?.map((part) => ({ ...part })),
	};
}
