import { appCommands } from "../commands/registry.ts";
import type { DatastarStream } from "../server/datastar.ts";
import { datastarStream, refreshBasecoatComponentsScript } from "../server/datastar.ts";
import { renderDebugOverlay } from "../ui/debug.tsx";
import { renderPierreDiff } from "../ui/diffs.ts";
import {
	renderCodeFinal,
	renderMarkdownFinal,
	renderMarkdownStreaming,
} from "../ui/markdown.tsx";
import { renderMessage, renderMessages } from "../ui/messages.tsx";
import {
	renderSessionPicker,
	renderSlashPicker,
	renderWorkspaceDialogMenu,
} from "../ui/pickers.tsx";
import {
	renderPromptAction,
	renderPromptQueue,
	renderPromptStatus,
	renderModelPicker,
	renderThinkingPicker,
	renderWorkspacePicker,
} from "../ui/prompt-box.tsx";
import { renderTreePicker } from "../ui/tree-picker.tsx";
import { formatShortcut } from "../utils/keyboard.ts";
import { defaultWorkspacePath } from "../utils/workspace.ts";

export type AppMessage = {
	id: string;
	role: "user" | "assistant" | "system" | "tool" | "thought" | "compaction" | "skill";
	text: string;
	timestamp: Date;
	title?: string;
	titleParts?: AppMessageTitlePart[];
	meta?: string;
	state?: "running" | "success" | "error";
	format?: "pre" | "diff";
	renderedHtml?: string;
};

export type AppMessageTitlePart = {
	text: string;
	tone?: "default" | "accent" | "warning" | "muted";
	mono?: boolean;
};

export type AppMessageOptions = Pick<
	AppMessage,
	"title" | "titleParts" | "meta" | "state" | "format"
>;

export type AppChatSnapshot = {
	messageSeq: number;
	activeAssistantId: string | undefined;
	activeThoughtId: string | undefined;
	transcriptMessages: AppMessage[];
	visibleMessageStart: number;
	emptyChatHint: AppKeybindHint;
	activityText: string | undefined;
	queuedSteeringMessages: string[];
	queuedFollowUpMessages: string[];
};

export type AppModel = {
	id: string;
	provider: string;
	name: string;
	configured: boolean;
};

export type AppThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export type AppSlashCommand = {
	name: string;
	description: string;
	source: "prompt" | "skill" | "extension" | "system";
	argumentHint?: string;
};

export type AppSessionSummary = {
	path: string;
	cwd: string;
	title: string;
	subtitle: string;
	modified: string;
};

export type AppTreeEntry = {
	id: string;
	parentId: string | null;
	prefix: string;
	continuationPrefix: string;
	label?: string;
	role: string;
	text: string;
	meta: string;
	active: boolean;
	inPath: boolean;
};

export type AppUsage = {
	text: string;
	contextPercent?: number;
	codexText?: string;
	codexPrimaryPercent?: number;
	codexSecondaryPercent?: number;
};

export type AppKeybindHint = {
	keys: string;
	description: string;
};

export type AppMessageInput = Omit<AppMessage, "id" | "renderedHtml"> & {
	renderedHtml?: string;
};

type StreamClient = {
	id: string;
	stream: DatastarStream;
};

const restoredMessagePageSize = 50;
const olderMessagePageSize = 50;
const emptyChatHints: AppKeybindHint[] = [
	...appCommands
		.filter((command) => command.shortcut.display)
		.map((command) => ({
			keys: formatShortcut(command.shortcut.display),
			description: command.description,
		})),
	{ keys: "alt T", description: "Cycle thinking level." },
	{ keys: "@", description: "Attach a file path." },
	{ keys: "/", description: "Open slash commands and skills." },
];
const markdownMessageRoles = new Set<AppMessage["role"]>([
	"assistant",
	"thought",
	"compaction",
	"skill",
]);

function rendersMarkdown(role: AppMessage["role"]): boolean {
	return markdownMessageRoles.has(role);
}

function randomEmptyChatHint(): AppKeybindHint {
	return emptyChatHints[Math.floor(Math.random() * emptyChatHints.length)];
}

function debugUiEnabled(): boolean {
	return Deno.env.get("PI_UI_DEBUG") === "1";
}

export class AppState {
	private clients = new Map<string, StreamClient>();
	private messageSeq = 0;
	private activeAssistantId: string | undefined;
	private activeThoughtId: string | undefined;
	private streamingPatchTimer: ReturnType<typeof setTimeout> | undefined;
	private transcriptMessages: AppMessage[] = [];
	private visibleMessageStart = 0;
	readonly debugUi = debugUiEnabled();
	streamingPatchIntervalMs = 7;
	messages: AppMessage[] = [];
	models: AppModel[] = [];
	sessions: AppSessionSummary[] = [];
	treeEntries: AppTreeEntry[] = [];
	slashCommands: AppSlashCommand[] = [];
	currentModel: string | undefined;
	currentSessionPath: string | undefined;
	thinkingLevel: AppThinkingLevel = "off";
	thinkingLevels: AppThinkingLevel[] = ["off"];
	usage: AppUsage = { text: "$0.000 • 0 tokens" };
	emptyChatHint = randomEmptyChatHint();
	activityText: string | undefined;
	queuedSteeringMessages: string[] = [];
	queuedFollowUpMessages: string[] = [];
	workspacePath = defaultWorkspacePath();
	recentWorkspaces: string[] = [];

	get hasOlderMessages(): boolean {
		return this.visibleMessageStart > 0;
	}

	createStream(signal: AbortSignal): Response {
		const id = crypto.randomUUID();
		return datastarStream(
			(stream) => {
				this.clients.set(id, { id, stream });
				this.patchClient(stream);
				this.patchSignals(stream);
				signal.addEventListener(
					"abort",
					() => {
						this.clients.delete(id);
						stream.close();
					},
					{ once: true },
				);
			},
			{
				keepalive: true,
				onAbort: () => {
					this.clients.delete(id);
				},
			},
		);
	}

	appendMessage(
		role: AppMessage["role"],
		text: string,
		options: AppMessageOptions = {},
	): string {
		this.messageSeq += 1;
		const id = `m-${this.messageSeq}`;
		const message = {
			id,
			role,
			text,
			timestamp: new Date(),
			...options,
			renderedHtml:
				rendersMarkdown(role) && text.trim()
					? renderMarkdownStreaming(text, { cacheKey: id })
					: undefined,
		};
		this.transcriptMessages.push(message);
		this.refreshVisibleMessages();
		if (role === "assistant") {
			this.activeAssistantId = id;
		}
		if (role === "thought") {
			this.activeThoughtId = id;
		}
		this.broadcast();
		if (role === "tool" && options.format === "diff" && text.trim()) {
			void this.renderCode(id, "diff");
		}
		return id;
	}

	updateMessage(id: string, patch: Partial<Omit<AppMessage, "id">>): void {
		const message = this.transcriptMessages.find((item) => item.id === id);
		if (!message) {
			return;
		}
		Object.assign(message, patch);
		if (patch.text !== undefined || patch.format !== undefined) {
			message.renderedHtml = undefined;
		}
		this.broadcast();
		if (message.role === "tool" && message.format === "diff" && message.text.trim()) {
			void this.renderCode(id, "diff");
		}
	}

	appendThoughtDelta(delta: string): void {
		if (!this.activeThoughtId) {
			this.appendMessage("thought", delta);
			return;
		}
		const message = this.transcriptMessages.find(
			(item) => item.id === this.activeThoughtId,
		);
		if (!message) {
			this.appendMessage("thought", delta);
			return;
		}
		message.text += delta;
		this.scheduleStreamingPatch();
	}

	appendAssistantDelta(delta: string): void {
		this.activeThoughtId = undefined;
		if (!this.activeAssistantId) {
			this.appendMessage("assistant", delta);
			return;
		}
		const message = this.transcriptMessages.find(
			(item) => item.id === this.activeAssistantId,
		);
		if (!message) {
			this.appendMessage("assistant", delta);
			return;
		}
		message.text += delta;
		this.scheduleStreamingPatch();
	}

	finishAssistant(): void {
		this.flushStreamingPatch();
		const id = this.activeAssistantId;
		const thoughtId = this.activeThoughtId;
		this.activeAssistantId = undefined;
		this.activeThoughtId = undefined;
		this.broadcast();
		if (thoughtId) {
			void this.renderAssistantMarkdown(thoughtId);
		}
		if (id) {
			void this.renderAssistantMarkdown(id);
		}
	}

	snapshotChat(): AppChatSnapshot {
		return {
			messageSeq: this.messageSeq,
			activeAssistantId: this.activeAssistantId,
			activeThoughtId: this.activeThoughtId,
			transcriptMessages: this.transcriptMessages.map((message) => ({
				...message,
			})),
			visibleMessageStart: this.visibleMessageStart,
			emptyChatHint: this.emptyChatHint,
			activityText: this.activityText,
			queuedSteeringMessages: [...this.queuedSteeringMessages],
			queuedFollowUpMessages: [...this.queuedFollowUpMessages],
		};
	}

	restoreChat(snapshot: AppChatSnapshot): void {
		this.clearStreamingPatchTimer();
		this.messageSeq = snapshot.messageSeq;
		this.activeAssistantId = snapshot.activeAssistantId;
		this.activeThoughtId = snapshot.activeThoughtId;
		this.transcriptMessages = snapshot.transcriptMessages.map((message) => ({
			...message,
		}));
		this.visibleMessageStart = snapshot.visibleMessageStart;
		this.emptyChatHint = snapshot.emptyChatHint;
		this.activityText = snapshot.activityText;
		this.queuedSteeringMessages = [...snapshot.queuedSteeringMessages];
		this.queuedFollowUpMessages = [...snapshot.queuedFollowUpMessages];
		this.refreshVisibleMessages();
		this.broadcast();
	}

	resetChat(): void {
		this.clearStreamingPatchTimer();
		this.transcriptMessages = [];
		this.messages = [];
		this.visibleMessageStart = 0;
		this.activeAssistantId = undefined;
		this.activeThoughtId = undefined;
		this.emptyChatHint = randomEmptyChatHint();
		this.broadcast();
	}

	replaceMessages(messages: AppMessageInput[]): void {
		this.clearStreamingPatchTimer();
		this.activeAssistantId = undefined;
		this.activeThoughtId = undefined;
		if (messages.length === 0) {
			this.emptyChatHint = randomEmptyChatHint();
		}
		this.transcriptMessages = messages.map((message) => {
			this.messageSeq += 1;
			return {
				...message,
				id: `m-${this.messageSeq}`,
			};
		});
		this.visibleMessageStart = Math.max(
			0,
			this.transcriptMessages.length - restoredMessagePageSize,
		);
		this.refreshVisibleMessages();
		this.broadcast();
		this.renderVisibleDiffs();
		this.renderVisibleMarkdownFinals();
	}

	loadOlderMessages(options: { broadcast?: boolean } = {}): boolean {
		if (!this.hasOlderMessages) return false;
		this.visibleMessageStart = Math.max(
			0,
			this.visibleMessageStart - olderMessagePageSize,
		);
		this.refreshVisibleMessages();
		if (options.broadcast !== false) {
			this.broadcast();
		}
		this.renderVisibleDiffs();
		this.renderVisibleMarkdownFinals();
		return true;
	}

	renderMessagesElement(): string {
		return renderMessages(
			this.messages,
			this.emptyChatHint,
			this.hasOlderMessages,
			this.sessions,
		);
	}

	private refreshVisibleMessages(): void {
		this.messages = this.transcriptMessages.slice(this.visibleMessageStart);
		for (const message of this.messages) {
			this.prepareMessageForDisplay(message);
		}
	}

	private prepareMessageForDisplay(message: AppMessage): void {
		if (
			!rendersMarkdown(message.role) ||
			!message.text.trim() ||
			message.renderedHtml
		) {
			return;
		}
		message.renderedHtml = renderMarkdownStreaming(message.text, {
			cacheKey: message.id,
		});
	}

	private renderVisibleDiffs(): void {
		for (const message of this.messages) {
			if (
				message.role === "tool" &&
				message.format === "diff" &&
				message.text.trim() &&
				!message.renderedHtml
			) {
				void this.renderCode(message.id, "diff");
			}
		}
	}

	private renderVisibleMarkdownFinals(): void {
		for (const message of this.messages) {
			if (rendersMarkdown(message.role) && message.text.trim()) {
				void this.renderAssistantMarkdown(message.id);
			}
		}
	}

	setModels(models: AppModel[], currentModel: string | undefined): void {
		this.models = models;
		this.currentModel = currentModel;
		this.broadcast(refreshBasecoatComponentsScript("#model-select"));
		this.broadcastSignals();
	}

	setThinking(level: AppThinkingLevel, levels: AppThinkingLevel[]): void {
		this.thinkingLevel = level;
		this.thinkingLevels = levels.length > 0 ? levels : ["off"];
		this.broadcast(refreshBasecoatComponentsScript("#thinking-select"));
		this.broadcastSignals();
	}

	setSessions(sessions: AppSessionSummary[]): void {
		this.sessions = sessions;
		this.broadcast(
			refreshBasecoatComponentsScript(
				"#session-dialog .command",
				"#workspace-dialog .command",
			),
		);
	}

	setRecentWorkspaces(recentWorkspaces: string[]): void {
		this.recentWorkspaces = recentWorkspaces;
	}

	setSlashCommands(commands: AppSlashCommand[]): void {
		this.slashCommands = commands;
		this.broadcast();
	}

	setTreeEntries(entries: AppTreeEntry[]): void {
		this.treeEntries = entries;
		this.broadcast(refreshBasecoatComponentsScript("#tree-dialog .command"));
	}

	setCurrentModel(currentModel: string | undefined): void {
		this.currentModel = currentModel;
		this.broadcast(refreshBasecoatComponentsScript("#model-select"));
		this.broadcastSignals();
	}

	setUsage(usage: AppUsage): void {
		this.usage = usage;
		this.broadcast();
	}

	setActivityText(activityText: string | undefined): void {
		this.activityText = activityText;
		this.broadcast();
		this.broadcastSignals();
	}

	setQueuedMessages(steering: readonly string[], followUp: readonly string[]): void {
		this.queuedSteeringMessages = [...steering];
		this.queuedFollowUpMessages = [...followUp];
		this.broadcast();
	}

	setCurrentSessionPath(currentSessionPath: string | undefined): void {
		this.currentSessionPath = currentSessionPath;
		this.broadcast(refreshBasecoatComponentsScript("#session-dialog .command"));
	}

	setWorkspacePath(workspacePath: string): void {
		this.workspacePath = workspacePath;
		this.broadcast(refreshBasecoatComponentsScript("#workspace-dialog .command"));
		this.broadcastSignals();
	}

	private scheduleStreamingPatch(): void {
		if (this.streamingPatchTimer !== undefined) return;
		this.streamingPatchTimer = setTimeout(() => {
			this.streamingPatchTimer = undefined;
			this.flushStreamingPatch();
		}, this.streamingPatchIntervalMs);
	}

	private clearStreamingPatchTimer(): void {
		if (this.streamingPatchTimer === undefined) return;
		clearTimeout(this.streamingPatchTimer);
		this.streamingPatchTimer = undefined;
	}

	private flushStreamingPatch(): void {
		this.clearStreamingPatchTimer();
		if (this.activeThoughtId) {
			this.patchStreamingMessage(this.activeThoughtId);
		}
		if (this.activeAssistantId) {
			this.patchStreamingMessage(this.activeAssistantId);
		}
	}

	private patchStreamingMessage(id: string): void {
		const message = this.transcriptMessages.find((item) => item.id === id);
		if (!message || !rendersMarkdown(message.role) || !message.text.trim()) return;
		message.renderedHtml = renderMarkdownStreaming(message.text, { cacheKey: id });
		this.broadcastMessage(message);
	}

	private async renderCode(id: string, language: string): Promise<void> {
		const message = this.transcriptMessages.find((item) => item.id === id);
		if (!message || !message.text.trim()) {
			return;
		}

		const text = message.text;
		const renderedHtml =
			(language === "diff" ? await renderPierreDiff(text) : undefined) ??
			(await renderCodeFinal(text, language, { chrome: false }));
		const current = this.transcriptMessages.find((item) => item.id === id);
		if (!current || current.text !== text) {
			return;
		}

		current.renderedHtml = renderedHtml;
		this.broadcast();
	}

	private async renderAssistantMarkdown(id: string): Promise<void> {
		const message = this.transcriptMessages.find((item) => item.id === id);
		if (!message || !rendersMarkdown(message.role) || !message.text.trim()) {
			return;
		}

		const text = message.text;
		const renderedHtml = await renderMarkdownFinal(text);
		const current = this.transcriptMessages.find((item) => item.id === id);
		if (!current || current.text !== text) {
			return;
		}

		current.renderedHtml = renderedHtml;
		this.broadcast();
	}

	private renderElements(): string {
		return (
			this.renderMessagesElement() +
			renderPromptAction(this) +
			renderPromptQueue(this) +
			renderPromptStatus(this) +
			renderWorkspacePicker(this) +
			renderWorkspaceDialogMenu(this) +
			renderModelPicker(this) +
			renderThinkingPicker(this) +
			renderDebugOverlay(this) +
			renderSessionPicker(this) +
			renderSlashPicker(this) +
			renderTreePicker(this)
		);
	}

	private patchClient(stream: DatastarStream, script?: string): void {
		try {
			stream.patchElements(this.renderElements());
			if (script) {
				stream.executeScript(script);
			}
		} catch {
			// Client already disconnected.
		}
	}

	private patchSignals(stream: DatastarStream): void {
		try {
			stream.patchSignals(
				JSON.stringify({
					model: this.currentModel ?? "",
					thinkingLevel: this.thinkingLevel,
					workspacePath: this.workspacePath,
					isBusy: Boolean(this.activityText),
					treeEntryId: "",
					treeSummarize: false,
					treeSummaryInstructions: "",
				}),
			);
		} catch {
			// Client already disconnected.
		}
	}

	private broadcast(script?: string): void {
		for (const client of this.clients.values()) {
			this.patchClient(client.stream, script);
		}
	}

	private broadcastMessage(message: AppMessage): void {
		for (const client of this.clients.values()) {
			try {
				client.stream.patchElements(renderMessage(message), {
					selector: `[data-message-id="${message.id}"]`,
				});
			} catch {
				// Client already disconnected.
			}
		}
	}

	private broadcastSignals(): void {
		for (const client of this.clients.values()) {
			this.patchSignals(client.stream);
		}
	}
}
