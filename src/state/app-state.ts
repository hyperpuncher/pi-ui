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
	renderModelPicker,
	renderPromptAction,
	renderPromptQueue,
	renderPromptStatus,
	renderPromptToolbar,
	renderThinkingPicker,
	renderWorkspacePicker,
} from "../ui/prompt-box.tsx";
import { renderSessionTransition } from "../ui/session-transition.tsx";
import { renderTreePicker } from "../ui/tree-picker.tsx";
import { formatShortcut } from "../utils/keyboard.ts";
import { defaultWorkspacePath } from "../utils/workspace.ts";
import { EnhancementQueue } from "./enhancement-queue.ts";

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
	presentationState: "plain" | "streaming" | "enhancing" | "final";
	presentationVersion: number;
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

export type AppMessageInput = Omit<
	AppMessage,
	"id" | "renderedHtml" | "presentationState" | "presentationVersion"
> & {
	renderedHtml?: string;
};

type EnhancementKind = "markdown" | "code" | "diff";

type AppStateOptions = {
	enhancementConcurrency?: number;
	renderMarkdownFinal?: (text: string) => Promise<string>;
	renderCode?: (text: string, language: string) => Promise<string>;
	renderDiff?: (text: string) => Promise<string | undefined>;
};

type AppStateUpdateOptions = {
	flush?: boolean;
	commit?: boolean;
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

function enhancementKind(message: AppMessage): EnhancementKind | undefined {
	if (rendersMarkdown(message.role)) return "markdown";
	if (message.role !== "tool") return undefined;
	if (message.format === "diff") return "diff";
	if (message.format === "code") return "code";
	return undefined;
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
	private enhancementGeneration = 0;
	private readonly enhancementQueue: EnhancementQueue;
	private readonly renderMarkdownEnhancement: (text: string) => Promise<string>;
	private readonly renderCodeEnhancement: (
		text: string,
		language: string,
	) => Promise<string>;
	private readonly renderDiffEnhancement: (text: string) => Promise<string | undefined>;
	private suppressMessagePatchesDepth = 0;
	private updateDepth = 0;
	private commitPending = false;
	private commitScheduled = false;
	private pendingScripts = new Set<string>();
	private pendingSignalOverrides: Record<string, unknown> = {};
	private pendingEnhancementIds = new Set<string>();
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

	constructor(options: AppStateOptions = {}) {
		this.enhancementQueue = new EnhancementQueue(options.enhancementConcurrency ?? 2);
		this.renderMarkdownEnhancement =
			options.renderMarkdownFinal ?? renderMarkdownFinal;
		this.renderCodeEnhancement =
			options.renderCode ??
			((text, language) =>
				renderPierreCode(text, language, { disableLineNumbers: true }));
		this.renderDiffEnhancement = options.renderDiff ?? renderPierreDiff;
	}

	get hasOlderMessages(): boolean {
		return this.visibleMessageStart > 0;
	}

	async suppressMessagePatches<T>(callback: () => Promise<T>): Promise<T> {
		this.suppressMessagePatchesDepth += 1;
		try {
			return await callback();
		} finally {
			// Flush while suppression is active so a deferred commit cannot restore the
			// transcript that this boundary intentionally omitted.
			this.flush();
			this.suppressMessagePatchesDepth -= 1;
		}
	}

	/** Mutates authoritative state and coalesces nested/synchronous work into one view. */
	update<T>(mutator: () => T, options: AppStateUpdateOptions = {}): T {
		this.updateDepth += 1;
		try {
			return mutator();
		} finally {
			this.updateDepth -= 1;
			if (options.commit !== false) this.requestCommit();
			if (this.updateDepth === 0 && this.commitPending) this.requestCommit();
			if (options.flush) this.flush();
		}
	}

	/** Commits pending state now. Use at observable ordering boundaries. */
	flush(): void {
		if (this.updateDepth > 0 || !this.commitPending) return;
		this.commitPending = false;
		this.commitScheduled = false;
		const scripts = [...this.pendingScripts];
		this.pendingScripts.clear();
		const signalOverrides = this.pendingSignalOverrides;
		this.pendingSignalOverrides = {};
		const enhancementIds = [...this.pendingEnhancementIds];
		this.pendingEnhancementIds.clear();

		if (this.clients.size > 0) {
			const elements = this.renderElements();
			const signals = this.renderSignals(signalOverrides);
			for (const client of this.clients.values()) {
				this.commitClient(client.stream, elements, signals, scripts);
			}
		}
		for (const id of enhancementIds) this.enqueueMessageEnhancement(id);
	}

	createStream(signal: AbortSignal): Response {
		// Consume headless pending work before attaching; the initial stream render
		// already reflects the latest authoritative state.
		this.flush();
		const id = crypto.randomUUID();
		return datastarStream(
			(stream) => {
				this.clients.set(id, { id, stream });
				const elements = this.renderElements();
				this.commitClient(stream, elements, this.renderSignals(), []);
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
		const message: AppMessage = {
			id,
			role,
			text,
			timestamp: new Date(),
			...options,
			renderedHtml:
				rendersMarkdown(role) && text.trim()
					? renderMarkdownStreaming(text, { cacheKey: id })
					: undefined,
			presentationState: rendersMarkdown(role) ? "streaming" : "plain",
			presentationVersion: 0,
		};
		this.transcriptMessages.push(message);
		this.refreshVisibleMessages();
		if (role === "assistant") {
			this.activeAssistantId = id;
		}
		if (role === "thought") {
			this.activeThoughtId = id;
		}
		this.requestCommit();
		if (role === "tool") this.scheduleMessageEnhancement(id);
		return id;
	}

	updateMessage(id: string, patch: Partial<Omit<AppMessage, "id">>): void {
		const message = this.transcriptMessages.find((item) => item.id === id);
		if (!message) {
			return;
		}
		Object.assign(message, patch);
		if (patch.text !== undefined || patch.format !== undefined) {
			releaseMarkdownStreamingState(id);
			message.renderedHtml = undefined;
			message.presentationState = "plain";
			message.presentationVersion += 1;
		}
		this.requestCommit();
		this.scheduleMessageEnhancement(id);
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
		message.presentationVersion += 1;
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
		message.presentationVersion += 1;
		this.scheduleStreamingPatch();
	}

	finishAssistant(): void {
		this.flushStreamingPatch();
		const id = this.activeAssistantId;
		const thoughtId = this.activeThoughtId;
		this.activeAssistantId = undefined;
		this.activeThoughtId = undefined;
		this.requestCommit();
		if (thoughtId) this.scheduleMessageEnhancement(thoughtId);
		if (id) this.scheduleMessageEnhancement(id);
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
		this.cancelEnhancements();
		this.releaseTranscriptMarkdownStreamingState();
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
		this.requestCommit();
		this.scheduleEnhancements(this.messages.map((message) => message.id));
	}

	resetChat(options: { preserveEmptyHint?: boolean; broadcast?: boolean } = {}): void {
		this.clearStreamingPatchTimer();
		this.cancelEnhancements();
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
			this.requestCommit();
		}
	}

	replaceMessages(messages: AppMessageInput[]): void {
		const endProjection = sessionPerformance.startSpan("transcriptProjection");
		this.clearStreamingPatchTimer();
		this.cancelEnhancements();
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
				renderedHtml: undefined,
				presentationState: "plain",
				presentationVersion: 0,
			};
		});
		this.visibleMessageStart = Math.max(
			0,
			this.transcriptMessages.length - restoredMessagePageSize,
		);
		this.refreshVisibleMessages();
		endProjection();
		sessionPerformance.markTranscriptProjected();
		this.requestCommit();
		this.scheduleEnhancements(this.messages.map((message) => message.id));
	}

	loadOlderMessages(options: { broadcast?: boolean } = {}): boolean {
		if (!this.hasOlderMessages) return false;
		const previousStart = this.visibleMessageStart;
		this.visibleMessageStart = Math.max(
			0,
			this.visibleMessageStart - olderMessagePageSize,
		);
		const revealedIds = this.transcriptMessages
			.slice(this.visibleMessageStart, previousStart)
			.map((message) => message.id);
		this.refreshVisibleMessages();
		if (options.broadcast !== false) {
			this.requestCommit();
		}
		this.scheduleEnhancements(revealedIds);
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
		this.requestCommit(
			`${refreshBasecoatComponentsScript("#model-select")}${reopenScript}`,
		);
	}

	setThinking(level: AppThinkingLevel, levels: AppThinkingLevel[]): void {
		this.thinkingLevel = level;
		this.thinkingLevels = levels.length > 0 ? levels : ["off"];
		this.requestCommit(refreshBasecoatComponentsScript("#thinking-select"));
	}

	setSessions(
		sessions: AppSessionSummary[],
		_options: { patchMessages?: boolean } = {},
	): void {
		this.sessions = sessions;
		this.requestCommit(
			refreshBasecoatComponentsScript(
				"#workspace-dialog .command",
				"#session-dialog .command",
			),
		);
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
		this.requestCommit(refreshBasecoatComponentsScript("#workspace-dialog .command"));
	}

	setSlashCommands(commands: AppSlashCommand[]): void {
		this.slashCommands = commands;
		this.requestCommit();
	}

	setAuthDialog(
		dialog: AppAuthDialog | undefined,
		options: { resetInput?: boolean } = {},
	): void {
		this.authDialog = dialog;
		const script = dialog
			? "{ const dialog = document.getElementById('auth-dialog'); if (dialog && !dialog.open) dialog.showModal(); }"
			: "document.getElementById('auth-dialog')?.close?.()";
		if (options.resetInput) this.pendingSignalOverrides.authInput = "";
		this.requestCommit(script);
	}

	setTreeEntries(entries: AppTreeEntry[]): void {
		this.treeEntries = entries;
		this.requestCommit(refreshBasecoatComponentsScript("#tree-dialog .command"));
	}

	setCurrentModel(currentModel: string | undefined): void {
		this.currentModel = currentModel;
		this.requestCommit(refreshBasecoatComponentsScript("#model-select"));
	}

	setUsage(usage: AppUsage): void {
		this.usage = usage;
		this.requestCommit();
	}

	setActivityText(activityText: string | undefined): void {
		this.activityText = activityText;
		this.requestCommit();
	}

	setQueuedMessages(steering: readonly string[], followUp: readonly string[]): void {
		this.queuedSteeringMessages = [...steering];
		this.queuedFollowUpMessages = [...followUp];
		this.requestCommit();
	}

	setCurrentSessionPath(currentSessionPath: string | undefined): void {
		this.currentSessionPath = currentSessionPath;
		this.requestCommit();
	}

	setTemporarySession(isTemporarySession: boolean): void {
		this.isTemporarySession = isTemporarySession;
		this.requestCommit();
	}

	setWorkspacePath(workspacePath: string): void {
		this.workspacePath = workspacePath;
		this.requestCommit(refreshBasecoatComponentsScript("#workspace-dialog .command"));
	}

	setSessionTransition(sessionTransition: SessionTransitionState): void {
		// Commit restored transcript content before removing its transition loader.
		if (
			this.sessionTransition.status === "loading" &&
			sessionTransition.status !== "loading"
		) {
			this.flush();
		}
		this.sessionTransition = sessionTransition;
		this.requestCommit(
			sessionTransition.status === "loading"
				? undefined
				: refreshBasecoatComponentsScript("#session-dialog .command"),
		);
		// Loading and loader-clear/error are observable ordering boundaries.
		this.flush();
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
		if (!message || !rendersMarkdown(message.role) || !message.text.trim()) {
			return;
		}
		message.renderedHtml = renderMarkdownStreaming(message.text, {
			cacheKey: id,
		});
		message.presentationState = "streaming";
		this.broadcastMessage(message);
	}

	private cancelEnhancements(): void {
		this.enhancementGeneration += 1;
		this.enhancementQueue.cancelAll();
	}

	private scheduleEnhancements(ids: readonly string[]): void {
		for (const id of ids.toReversed()) this.pendingEnhancementIds.add(id);
		this.requestCommit();
	}

	private scheduleMessageEnhancement(id: string): void {
		this.pendingEnhancementIds.add(id);
		this.requestCommit();
	}

	private enqueueMessageEnhancement(id: string): void {
		const message = this.transcriptMessages.find((item) => item.id === id);
		const kind = message ? enhancementKind(message) : undefined;
		if (
			!message ||
			!kind ||
			(kind === "markdown" &&
				(id === this.activeAssistantId || id === this.activeThoughtId)) ||
			!message.text.trim() ||
			message.presentationState === "enhancing" ||
			message.presentationState === "final"
		) {
			return;
		}

		const generation = this.enhancementGeneration;
		const text = message.text;
		const format = message.format;
		const version = message.presentationVersion;
		message.presentationState = "enhancing";
		this.enhancementQueue.enqueue({
			key: `${generation}:${id}:${version}:${kind}`,
			priority: this.transcriptMessages.indexOf(message),
			run: async (signal) => {
				const renderedHtml = await this.renderEnhancement(kind, text);
				if (signal.aborted) return;
				const current = this.transcriptMessages.find((item) => item.id === id);
				if (
					generation !== this.enhancementGeneration ||
					!current ||
					current.text !== text ||
					current.format !== format ||
					current.presentationVersion !== version
				) {
					return;
				}
				current.renderedHtml = renderedHtml;
				current.presentationState = "final";
				releaseMarkdownStreamingState(id);
				this.broadcastMessage(current);
			},
			onCancel: () => releaseMarkdownStreamingState(id),
			onError: (error) => {
				const current = this.transcriptMessages.find((item) => item.id === id);
				if (
					generation === this.enhancementGeneration &&
					current?.text === text &&
					current.format === format &&
					current.presentationVersion === version
				) {
					current.presentationState = "plain";
					current.renderedHtml = undefined;
					releaseMarkdownStreamingState(id);
				}
				console.warn(`Failed to enhance message ${id}`, error);
			},
		});
	}

	private async renderEnhancement(
		kind: EnhancementKind,
		text: string,
	): Promise<string> {
		if (kind === "markdown") {
			return await sessionPerformance.measure("markdownEnhancement", () =>
				this.renderMarkdownEnhancement(text),
			);
		}

		const endEnhancement = sessionPerformance.startSpan("toolEnhancement");
		try {
			if (kind === "diff") {
				return (
					(await this.renderDiffEnhancement(text)) ??
					(await renderCodeFinal(text, "diff", { chrome: false }))
				);
			}
			return await this.renderCodeEnhancement(text, "bash");
		} finally {
			endEnhancement();
		}
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
			renderSessionPicker(this) +
			renderModelPicker(this) +
			renderThinkingPicker(this) +
			renderSessionTransition(this) +
			renderDebugOverlay(this) +
			renderSlashPicker(this) +
			renderTreePicker(this)
		);
	}

	private renderSignals(overrides: Record<string, unknown> = {}): string {
		return JSON.stringify({
			model: this.currentModel ?? "",
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
			...overrides,
		});
	}

	private commitClient(
		stream: DatastarStream,
		elements: string,
		signals: string,
		scripts: readonly string[],
	): void {
		try {
			stream.patchElements(elements);
			sessionPerformance.recordFatMorph(elements);
			sessionPerformance.markFirstTranscriptPatch();
			stream.patchSignals(signals);
			if (scripts.length > 0) stream.executeScript(scripts.join(";"));
		} catch {
			// Client already disconnected.
		}
	}

	private requestCommit(script?: string): void {
		this.commitPending = true;
		if (script) this.pendingScripts.add(script);
		if (this.updateDepth > 0 || this.commitScheduled) return;
		this.commitScheduled = true;
		queueMicrotask(() => {
			if (!this.commitScheduled) return;
			this.commitScheduled = false;
			this.flush();
		});
	}

	/** Targeted exception: active streaming and completed enhancement messages only. */
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
}
