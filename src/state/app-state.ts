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
import { shouldDeferEnhancement } from "./enhancement-policy.ts";
import { EnhancementQueue } from "./enhancement-queue.ts";
import { StreamingFrameScheduler } from "./streaming-frame-scheduler.ts";
import {
	TranscriptState,
	type TranscriptMessage,
	type TranscriptMessageInput,
	type TranscriptMessageOptions,
	type TranscriptMessageTitlePart,
	type TranscriptSnapshot,
} from "./transcript-state.ts";

export type AppMessage = TranscriptMessage & {
	renderedHtml?: string;
	presentationState: "plain" | "streaming" | "deferred" | "enhancing" | "final";
	presentationVersion: number;
};

export type AppMessageTitlePart = TranscriptMessageTitlePart;
export type AppMessageOptions = TranscriptMessageOptions;
export type AppChatSnapshot = TranscriptSnapshot;

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

export type AppMessageInput = TranscriptMessageInput & { renderedHtml?: string };

type MessagePresentation = Pick<
	AppMessage,
	"renderedHtml" | "presentationState" | "presentationVersion"
>;

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
	private readonly transcript: TranscriptState;
	private readonly messagePresentation = new Map<string, MessagePresentation>();
	private readonly streamingScheduler: StreamingFrameScheduler<readonly string[]>;
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
	readonly debugUi = debugUiEnabled();
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
	activityText: string | undefined;
	queuedSteeringMessages: string[] = [];
	queuedFollowUpMessages: string[] = [];
	workspacePath = defaultWorkspacePath();
	recentWorkspaces: string[] = [];
	sessionTransition: SessionTransitionState = { status: "idle", generation: 0 };

	constructor(options: AppStateOptions = {}) {
		this.transcript = new TranscriptState(randomEmptyChatHint());
		this.syncTranscriptMetadata();
		this.streamingScheduler = new StreamingFrameScheduler((ids) => {
			for (const id of ids) this.patchStreamingMessage(id);
		});
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
		return this.transcript.hasOlderMessages;
	}

	get emptyChatHint(): AppKeybindHint {
		return this.transcript.emptyChatHint;
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
		const id = this.transcript.appendMessage(role, text, options);
		this.messagePresentation.set(id, {
			renderedHtml:
				rendersMarkdown(role) && text.trim()
					? renderMarkdownStreaming(text, { cacheKey: id })
					: undefined,
			presentationState: rendersMarkdown(role) ? "streaming" : "plain",
			presentationVersion: 0,
		});
		this.refreshVisibleMessages();
		this.requestCommit();
		if (role === "tool") this.scheduleMessageEnhancement(id);
		return id;
	}

	updateMessage(id: string, patch: Partial<Omit<AppMessage, "id">>): void {
		const {
			renderedHtml: _,
			presentationState: __,
			presentationVersion: ___,
			...domain
		} = patch;
		if (!this.transcript.updateMessage(id, domain)) return;
		const presentation = this.ensurePresentation(id);
		if (patch.text !== undefined || patch.format !== undefined) {
			releaseMarkdownStreamingState(id);
			presentation.renderedHtml = undefined;
			presentation.presentationState = "plain";
			presentation.presentationVersion += 1;
		}
		this.refreshVisibleMessages();
		this.requestCommit();
		this.scheduleMessageEnhancement(id);
	}

	appendThoughtDelta(delta: string): void {
		const previousId = this.transcript.activeThoughtMessageId;
		const id = this.transcript.appendThoughtDelta(delta);
		if (!previousId) {
			this.initializeStreamingPresentation(id);
			this.refreshVisibleMessages();
			this.requestCommit();
			return;
		}
		this.ensurePresentation(id).presentationVersion += 1;
		this.refreshVisibleMessages();
		this.scheduleStreamingPatch();
	}

	appendAssistantDelta(delta: string): void {
		const previousId = this.transcript.activeAssistantMessageId;
		const id = this.transcript.appendAssistantDelta(delta);
		if (!previousId) {
			this.initializeStreamingPresentation(id);
			this.refreshVisibleMessages();
			this.requestCommit();
			return;
		}
		this.ensurePresentation(id).presentationVersion += 1;
		this.refreshVisibleMessages();
		this.scheduleStreamingPatch();
	}

	finishAssistant(): void {
		this.flushStreamingPatch();
		const { assistantId, thoughtId } = this.transcript.finishAssistant();
		this.refreshVisibleMessages();
		this.requestCommit();
		if (thoughtId) this.scheduleMessageEnhancement(thoughtId);
		if (assistantId) this.scheduleMessageEnhancement(assistantId);
	}

	snapshotChat(): AppChatSnapshot {
		this.syncTranscriptMetadata();
		return this.transcript.snapshot();
	}

	restoreChat(snapshot: AppChatSnapshot): void {
		const endProjection = sessionPerformance.startSpan("transcriptProjection");
		this.clearStreamingPatchTimer();
		this.cancelEnhancements();
		this.releaseTranscriptMarkdownStreamingState();
		this.messagePresentation.clear();
		this.transcript.restore(snapshot);
		this.syncAppMetadata();
		for (const id of [snapshot.activeThoughtId, snapshot.activeAssistantId]) {
			if (id) this.initializeStreamingPresentation(id);
		}
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
		this.messagePresentation.clear();
		this.transcript.reset(
			options.preserveEmptyHint ? undefined : randomEmptyChatHint(),
		);
		this.refreshVisibleMessages();
		if (options.broadcast !== false) this.requestCommit();
	}

	replaceMessages(messages: AppMessageInput[]): void {
		const endProjection = sessionPerformance.startSpan("transcriptProjection");
		this.clearStreamingPatchTimer();
		this.cancelEnhancements();
		this.releaseTranscriptMarkdownStreamingState();
		this.messagePresentation.clear();
		this.transcript.replaceMessages(
			messages.map(({ renderedHtml: _, ...message }) => message),
			messages.length === 0 ? randomEmptyChatHint() : undefined,
		);
		this.refreshVisibleMessages();
		endProjection();
		sessionPerformance.markTranscriptProjected();
		this.requestCommit();
		this.scheduleEnhancements(this.messages.map((message) => message.id));
	}

	loadOlderMessages(options: { broadcast?: boolean } = {}): boolean {
		const revealedIds = this.transcript.loadOlderMessages();
		if (revealedIds.length === 0) return false;
		this.refreshVisibleMessages();
		if (options.broadcast !== false) this.requestCommit();
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
		this.messages = this.transcript.messages.map((message) =>
			this.projectMessage(message),
		);
	}

	private projectMessage(message: TranscriptMessage): AppMessage {
		return { ...message, ...this.ensurePresentation(message.id) };
	}

	private ensurePresentation(id: string): MessagePresentation {
		let presentation = this.messagePresentation.get(id);
		if (!presentation) {
			presentation = {
				presentationState: "plain",
				presentationVersion: 0,
			};
			this.messagePresentation.set(id, presentation);
		}
		return presentation;
	}

	private initializeStreamingPresentation(id: string): void {
		const message = this.transcript.getMessage(id);
		if (!message) return;
		this.messagePresentation.set(id, {
			renderedHtml: message.text.trim()
				? renderMarkdownStreaming(message.text, { cacheKey: id })
				: undefined,
			presentationState: "streaming",
			presentationVersion: 0,
		});
	}

	private syncTranscriptMetadata(): void {
		this.transcript.setActivityText(this.activityText);
		this.transcript.setQueuedMessages(
			this.queuedSteeringMessages,
			this.queuedFollowUpMessages,
		);
	}

	private syncAppMetadata(): void {
		this.activityText = this.transcript.activityText;
		this.queuedSteeringMessages = [...this.transcript.queuedSteeringMessages];
		this.queuedFollowUpMessages = [...this.transcript.queuedFollowUpMessages];
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
		this.transcript.setActivityText(activityText);
		this.requestCommit();
	}

	setQueuedMessages(steering: readonly string[], followUp: readonly string[]): void {
		this.queuedSteeringMessages = [...steering];
		this.queuedFollowUpMessages = [...followUp];
		this.transcript.setQueuedMessages(steering, followUp);
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

	setDisplayRefreshHz(hz: number): boolean {
		return this.streamingScheduler.setDisplayHz(hz);
	}

	enhanceMessage(id: string): boolean {
		const message = this.transcript.getMessage(id);
		if (!message || this.ensurePresentation(id).presentationState !== "deferred") {
			return false;
		}
		this.enqueueMessageEnhancement(id, true);
		return true;
	}

	private streamingMessageIds(): readonly string[] {
		return uniqueStrings(
			[
				this.transcript.activeThoughtMessageId,
				this.transcript.activeAssistantMessageId,
			].filter((id): id is string => id !== undefined),
		);
	}

	private scheduleStreamingPatch(): void {
		this.streamingScheduler.schedule(this.streamingMessageIds());
	}

	private clearStreamingPatchTimer(): void {
		this.streamingScheduler.clear();
	}

	private flushStreamingPatch(): void {
		this.streamingScheduler.flush(this.streamingMessageIds());
	}

	private patchStreamingMessage(id: string): void {
		const message = this.transcript.getMessage(id);
		if (!message || !rendersMarkdown(message.role) || !message.text.trim()) return;
		const presentation = this.ensurePresentation(id);
		presentation.renderedHtml = renderMarkdownStreaming(message.text, {
			cacheKey: id,
		});
		presentation.presentationState = "streaming";
		this.refreshVisibleMessages();
		this.broadcastMessage(this.projectMessage(message));
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

	private enqueueMessageEnhancement(id: string, force = false): void {
		const message = this.transcript.getMessage(id);
		const kind = message ? enhancementKind(this.projectMessage(message)) : undefined;
		const presentation = message ? this.ensurePresentation(id) : undefined;
		if (
			!message ||
			!kind ||
			!presentation ||
			(kind === "markdown" && this.streamingMessageIds().includes(id)) ||
			!message.text.trim() ||
			presentation.presentationState === "enhancing" ||
			presentation.presentationState === "final" ||
			(presentation.presentationState === "deferred" && !force)
		)
			return;
		if (!force && shouldDeferEnhancement(kind, message.text)) {
			presentation.presentationState = "deferred";
			this.refreshVisibleMessages();
			this.broadcastMessage(this.projectMessage(message));
			return;
		}

		const generation = this.enhancementGeneration;
		const text = message.text;
		const format = message.format;
		const version = presentation.presentationVersion;
		presentation.presentationState = "enhancing";
		this.enhancementQueue.enqueue({
			key: `${generation}:${id}:${version}:${kind}`,
			priority: this.transcript.allMessages.indexOf(message),
			run: async (signal) => {
				const renderedHtml = await this.renderEnhancement(kind, text);
				if (signal.aborted) return;
				const current = this.transcript.getMessage(id);
				const currentPresentation = this.ensurePresentation(id);
				if (
					generation !== this.enhancementGeneration ||
					!current ||
					current.text !== text ||
					current.format !== format ||
					currentPresentation.presentationVersion !== version
				)
					return;
				currentPresentation.renderedHtml = renderedHtml;
				currentPresentation.presentationState = "final";
				releaseMarkdownStreamingState(id);
				this.refreshVisibleMessages();
				this.broadcastMessage(this.projectMessage(current));
			},
			onCancel: () => releaseMarkdownStreamingState(id),
			onError: (error) => {
				const current = this.transcript.getMessage(id);
				const currentPresentation = this.ensurePresentation(id);
				if (
					generation === this.enhancementGeneration &&
					current?.text === text &&
					current.format === format &&
					currentPresentation.presentationVersion === version
				) {
					currentPresentation.presentationState = "plain";
					currentPresentation.renderedHtml = undefined;
					releaseMarkdownStreamingState(id);
					this.refreshVisibleMessages();
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
		for (const message of this.transcript.allMessages) {
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
