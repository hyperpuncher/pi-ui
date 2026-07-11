import type { SessionTransitionState } from "../agent/session-transition-controller.ts";
import { appCommands } from "../commands/registry.ts";
import { sessionPerformance } from "../perf/session-performance.ts";
import type { DatastarStream } from "../server/datastar.ts";
import { datastarStream, refreshBasecoatComponentsScript } from "../server/datastar.ts";
import { renderAuthDialogContent } from "../ui/auth-dialog.tsx";
import { renderDebugOverlay } from "../ui/debug.tsx";
import { renderPierreCode, renderPierreDiff } from "../ui/diffs.ts";
import {
	releaseMarkdownStreamingState,
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
	renderPromptToolbar,
	renderModelPicker,
	renderThinkingPicker,
	renderWorkspacePicker,
} from "../ui/prompt-box.tsx";
import { renderSessionTransition } from "../ui/session-transition.tsx";
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
	format?: "pre" | "diff" | "code";
	renderedHtml?: string;
};

export type AppMessageTitlePart = {
	text: string;
	tone?: "default" | "accent" | "warning" | "muted";
	mono?: boolean;
	highlight?: "bash";
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
	scoped: boolean;
};

export type AppThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export type AppSlashCommand = {
	name: string;
	description: string;
	source: "prompt" | "skill" | "extension" | "system";
	argumentHint?: string;
};

export type AppAuthProvider = {
	id: string;
	name: string;
	authType: "oauth" | "api_key";
};

export type AppAuthPrompt = {
	message: string;
	placeholder?: string;
	allowEmpty?: boolean;
	options?: Array<{ id: string; label: string }>;
};

export type AppAuthDialog = {
	mode: "login" | "logout";
	phase: "providers" | "api-key" | "oauth" | "result";
	providers: AppAuthProvider[];
	providerId?: string;
	providerName?: string;
	status?: string;
	url?: string;
	instructions?: string;
	deviceCode?: string;
	prompt?: AppAuthPrompt;
	progress: string[];
	error?: string;
};

export type BackgroundSessionStatus = "running" | "completed";

export type AppSessionSummary = {
	path: string;
	cwd: string;
	title: string;
	subtitle: string;
	modified: string;
	backgroundStatus?: BackgroundSessionStatus;
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

function uniqueStrings(values: string[]): string[] {
	const unique: string[] = [];
	for (const value of values) {
		if (!value || unique.includes(value)) continue;
		unique.push(value);
	}
	return unique;
}

export class AppState {
	private clients = new Map<string, StreamClient>();
	private messageSeq = 0;
	private activeAssistantId: string | undefined;
	private activeThoughtId: string | undefined;
	private streamingPatchTimer: ReturnType<typeof setTimeout> | undefined;
	private replaceMessagesRenderSeq = 0;
	private suppressMessagePatchesDepth = 0;
	private transcriptMessages: AppMessage[] = [];
	private visibleMessageStart = 0;
	readonly debugUi = debugUiEnabled();
	streamingPatchIntervalMs = 7;
	messages: AppMessage[] = [];
	models: AppModel[] = [];
	sessions: AppSessionSummary[] = [];
	treeEntries: AppTreeEntry[] = [];
	slashCommands: AppSlashCommand[] = [];
	authDialog: AppAuthDialog | undefined;
	currentModel: string | undefined;
	currentSessionPath: string | undefined;
	isTemporarySession = false;
	thinkingLevel: AppThinkingLevel = "off";
	thinkingLevels: AppThinkingLevel[] = ["off"];
	usage: AppUsage = { text: "$0.000 • 0 tokens" };
	emptyChatHint = randomEmptyChatHint();
	activityText: string | undefined;
	queuedSteeringMessages: string[] = [];
	queuedFollowUpMessages: string[] = [];
	workspacePath = defaultWorkspacePath();
	recentWorkspaces: string[] = [];
	sessionTransition: SessionTransitionState = { status: "idle", generation: 0 };

	get hasOlderMessages(): boolean {
		return this.visibleMessageStart > 0;
	}

	async suppressMessagePatches<T>(callback: () => Promise<T>): Promise<T> {
		this.suppressMessagePatchesDepth += 1;
		try {
			return await callback();
		} finally {
			this.suppressMessagePatchesDepth -= 1;
		}
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
		void this.renderToolCodeMessage(id);
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
		void this.renderToolCodeMessage(id);
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
		const endProjection = sessionPerformance.startSpan("transcriptProjection");
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
		endProjection();
		sessionPerformance.markTranscriptProjected();
		this.broadcast();
		void this.renderVisibleToolCode();
		this.renderVisibleMarkdownFinals();
	}

	resetChat(options: { preserveEmptyHint?: boolean; broadcast?: boolean } = {}): void {
		this.clearStreamingPatchTimer();
		this.releaseTranscriptMarkdownStreamingState();
		this.transcriptMessages = [];
		this.messages = [];
		this.visibleMessageStart = 0;
		this.activeAssistantId = undefined;
		this.activeThoughtId = undefined;
		if (!options.preserveEmptyHint) {
			this.emptyChatHint = randomEmptyChatHint();
		}
		if (options.broadcast !== false) {
			this.broadcast();
		}
	}

	replaceMessages(messages: AppMessageInput[]): void {
		const endProjection = sessionPerformance.startSpan("transcriptProjection");
		this.clearStreamingPatchTimer();
		this.releaseTranscriptMarkdownStreamingState();
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
		endProjection();
		sessionPerformance.markTranscriptProjected();
		const renderSeq = ++this.replaceMessagesRenderSeq;
		void this.renderVisibleToolCode({ broadcast: false })
			.catch((error: unknown) =>
				console.warn("Failed to render tool output", error),
			)
			.finally(() => {
				if (renderSeq !== this.replaceMessagesRenderSeq) return;
				this.broadcast();
				this.renderVisibleMarkdownFinals();
			});
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
		void this.renderVisibleToolCode();
		this.renderVisibleMarkdownFinals();
		return true;
	}

	renderMessagesElement(): string {
		return renderMessages(
			this.messages,
			this.emptyChatHint,
			this.hasOlderMessages,
			this.sessions,
			this.sessionTransition.status !== "idle",
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

	private async renderVisibleToolCode(
		options: { broadcast?: boolean } = {},
	): Promise<void> {
		await Promise.all(
			this.messages.map((message) =>
				this.renderToolCodeMessage(message.id, options),
			),
		);
	}

	private async renderToolCodeMessage(
		id: string,
		options: { broadcast?: boolean } = {},
	): Promise<boolean> {
		const message = this.transcriptMessages.find((item) => item.id === id);
		if (message?.role !== "tool" || !message.text.trim() || message.renderedHtml) {
			return false;
		}
		if (message.format === "diff") {
			return await this.renderCode(message.id, "diff", options);
		}
		if (message.format === "code") {
			return await this.renderCode(message.id, "bash", options);
		}
		return false;
	}

	private renderVisibleMarkdownFinals(): void {
		for (const message of this.messages) {
			if (rendersMarkdown(message.role) && message.text.trim()) {
				void this.renderAssistantMarkdown(message.id);
			}
		}
	}

	setModels(
		models: AppModel[],
		currentModel: string | undefined,
		options: { reopenPicker?: boolean } = {},
	): void {
		this.models = models;
		this.currentModel = currentModel;
		const reopenScript = options.reopenPicker
			? ";requestAnimationFrame(() => { document.getElementById('model-select-trigger')?.focus(); document.getElementById('model-select')?.toggle?.(); })"
			: "";
		this.broadcast(
			`${refreshBasecoatComponentsScript("#model-select")}${reopenScript}`,
		);
		this.broadcastSignals();
	}

	setThinking(level: AppThinkingLevel, levels: AppThinkingLevel[]): void {
		this.thinkingLevel = level;
		this.thinkingLevels = levels.length > 0 ? levels : ["off"];
		this.broadcast(refreshBasecoatComponentsScript("#thinking-select"));
		this.broadcastSignals();
	}

	setSessions(
		sessions: AppSessionSummary[],
		options: { patchMessages?: boolean } = {},
	): void {
		this.sessions = sessions;
		const patchMessages = options.patchMessages ?? true;
		for (const client of this.clients.values()) {
			try {
				const elements =
					(patchMessages ? this.renderMessagesElement() : "") +
					renderWorkspaceDialogMenu(this) +
					renderSessionPicker(this);
				client.stream.patchElements(elements);
				sessionPerformance.recordFatMorph(elements);
				client.stream.executeScript(
					refreshBasecoatComponentsScript(
						"#workspace-dialog .command",
						"#session-dialog .command",
					),
				);
			} catch {
				// Client already disconnected.
			}
		}
	}

	removeSession(path: string): void {
		this.setSessions(this.sessions.filter((session) => session.path !== path));
	}

	setRecentWorkspaces(recentWorkspaces: string[]): void {
		this.recentWorkspaces = uniqueStrings([
			this.workspacePath,
			...recentWorkspaces,
			...this.recentWorkspaces,
		]).slice(0, 8);
		for (const client of this.clients.values()) {
			try {
				const elements = renderWorkspaceDialogMenu(this);
				client.stream.patchElements(elements);
				sessionPerformance.recordFatMorph(elements);
				client.stream.executeScript(
					refreshBasecoatComponentsScript("#workspace-dialog .command"),
				);
			} catch {
				// Client already disconnected.
			}
		}
	}

	setSlashCommands(commands: AppSlashCommand[]): void {
		this.slashCommands = commands;
		this.broadcast();
	}

	setAuthDialog(
		dialog: AppAuthDialog | undefined,
		options: { resetInput?: boolean } = {},
	): void {
		this.authDialog = dialog;
		const script = dialog
			? "{ const dialog = document.getElementById('auth-dialog'); if (dialog && !dialog.open) dialog.showModal(); }"
			: "document.getElementById('auth-dialog')?.close?.()";
		this.broadcast(script);
		if (options.resetInput) {
			for (const client of this.clients.values()) {
				try {
					client.stream.patchSignals(JSON.stringify({ authInput: "" }));
				} catch {
					// Client already disconnected.
				}
			}
		}
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
		this.broadcast();
	}

	setTemporarySession(isTemporarySession: boolean): void {
		this.isTemporarySession = isTemporarySession;
		this.broadcast();
		this.broadcastSignals();
	}

	setWorkspacePath(workspacePath: string): void {
		this.workspacePath = workspacePath;
		this.broadcast(refreshBasecoatComponentsScript("#workspace-dialog .command"));
		this.broadcastSignals();
	}

	setSessionTransition(sessionTransition: SessionTransitionState): void {
		this.sessionTransition = sessionTransition;
		this.broadcast();
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

	private async renderCode(
		id: string,
		language: string,
		options: { broadcast?: boolean } = {},
	): Promise<boolean> {
		const message = this.transcriptMessages.find((item) => item.id === id);
		if (!message || !message.text.trim()) {
			return false;
		}

		const text = message.text;
		const endEnhancement = sessionPerformance.startSpan("toolEnhancement");
		let renderedHtml: string;
		try {
			renderedHtml =
				language === "diff"
					? ((await renderPierreDiff(text)) ??
						(await renderCodeFinal(text, language, { chrome: false })))
					: await renderPierreCode(text, language, {
							disableLineNumbers: true,
						});
		} finally {
			endEnhancement();
		}
		const current = this.transcriptMessages.find((item) => item.id === id);
		if (!current || current.text !== text) {
			return false;
		}

		current.renderedHtml = renderedHtml;
		if (options.broadcast !== false) {
			this.broadcast();
		}
		return true;
	}

	private async renderAssistantMarkdown(id: string): Promise<void> {
		const message = this.transcriptMessages.find((item) => item.id === id);
		if (!message || !rendersMarkdown(message.role) || !message.text.trim()) {
			return;
		}

		const text = message.text;
		const renderedHtml = await sessionPerformance.measure("markdownEnhancement", () =>
			renderMarkdownFinal(text),
		);
		const current = this.transcriptMessages.find((item) => item.id === id);
		if (!current || current.text !== text) {
			return;
		}

		current.renderedHtml = renderedHtml;
		releaseMarkdownStreamingState(id);
		this.broadcast();
	}

	private releaseTranscriptMarkdownStreamingState(): void {
		for (const message of this.transcriptMessages) {
			releaseMarkdownStreamingState(message.id);
		}
	}

	private renderElements(): string {
		const messages =
			this.suppressMessagePatchesDepth > 0 ? "" : this.renderMessagesElement();
		return (
			messages +
			renderAuthDialogContent(this.authDialog) +
			renderPromptAction(this) +
			renderPromptQueue(this) +
			renderPromptToolbar(this) +
			renderPromptStatus(this) +
			renderWorkspacePicker(this) +
			renderWorkspaceDialogMenu(this) +
			renderModelPicker(this) +
			renderThinkingPicker(this) +
			renderSessionTransition(this) +
			renderDebugOverlay(this) +
			renderSlashPicker(this) +
			renderTreePicker(this)
		);
	}

	private patchClient(stream: DatastarStream, script?: string): void {
		try {
			const elements = this.renderElements();
			stream.patchElements(elements);
			sessionPerformance.recordFatMorph(elements);
			sessionPerformance.markFirstTranscriptPatch();
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
					modelCycleDirection: "forward",
					thinkingCycleDirection: "forward",
					thinkingLevel: this.thinkingLevel,
					workspacePath: this.workspacePath,
					isSessionReady: this.sessionTransition.status !== "loading",
					sessionTransitionLoading: this.sessionTransition.status === "loading",
					sessionTransitionVisible: this.sessionTransition.status !== "idle",
					sessionTransitionTarget:
						this.sessionTransition.status === "idle"
							? ""
							: this.sessionTransition.targetPath,
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
				const elements = renderMessage(message);
				client.stream.patchElements(elements, {
					selector: `[data-message-id="${message.id}"]`,
				});
				sessionPerformance.recordTargetedMessagePatch(elements);
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
