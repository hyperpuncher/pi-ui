import type { SessionTransitionState } from "#src/agent/session-transition-controller.ts";
import { appCommandCatalog } from "#src/commands/catalog.ts";
import { activeKeybind } from "#src/keybinds.ts";
import {
	sessionSidebarArchiveAfterDaysDefault,
	sessionSidebarWidthDefault,
} from "#src/session-sidebar-types.ts";
import {
	type TranscriptMessage,
	type TranscriptMessageInput,
	type TranscriptMessageOptions,
	type TranscriptSnapshot,
	TranscriptState,
} from "#src/state/transcript-state.ts";
import { clientScripts } from "#src/ui/client-scripts.ts";
import type { AvailableUpdate } from "#src/update-check.ts";
import { formatMessageCount, uniqueStrings } from "#src/utils/format.ts";
import { formatShortcut } from "#src/utils/keyboard.ts";
import type { JsonObject } from "#src/utils/type-guards.ts";
import { defaultWorkspacePath, managedWorktreeParts } from "#src/utils/workspace.ts";
import {
	unloadedWorkspaceReviewSnapshot,
	type WorkspaceReviewPreferences,
	type WorkspaceReviewSnapshot,
} from "#src/workspace-review-types.ts";

export type AppChatSnapshot = TranscriptSnapshot;
export type AppModel = {
	id: string;
	provider: string;
	name: string;
	configured: boolean;
	scoped: boolean;
};
export type AppThinkingLevel =
	"off" | "minimal" | "low" | "medium" | "high" | "xhigh" | "max";
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
	subscription?: boolean;
};
export type AppAuthPrompt = {
	id: string;
	message: string;
	placeholder?: string;
	secret?: boolean;
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
	openBrowserOnConfirm?: boolean;
	copyCodeOnConfirm?: boolean;
	prompt?: AppAuthPrompt;
	progress: string[];
	error?: string;
};
export type AppExtensionDialog =
	| { id: string; kind: "select"; title: string; options: readonly string[] }
	| { id: string; kind: "confirm"; title: string; message: string }
	| {
			id: string;
			kind: "input" | "editor";
			title: string;
			placeholder?: string;
			prefill?: string;
	  };
export type AppExtensionStatus = { key: string; text: string };
export type AppExtensionWidget = {
	key: string;
	lines: readonly string[];
	placement: "aboveEditor" | "belowEditor";
};
export type AppLlamaModel = { id: string; status: string };
export type AppLlamaDialog = {
	models: AppLlamaModel[];
	serverUrl?: string;
	busyModel?: string;
	progress?: { label: string; ratio?: number };
	status?: string;
	error?: string;
};
export type BackgroundSessionStatus = "running" | "completed";
export type AppSessionSummary = {
	path: string;
	cwd: string;
	title: string;
	messageCount: number;
	modified: string;
	modifiedAt?: string;
	backgroundStatus?: BackgroundSessionStatus;
};
export function sessionStatus(
	session: AppSessionSummary,
	state: Pick<AppStateSnapshot, "currentSessionPath" | "activityText">,
): BackgroundSessionStatus | undefined {
	if (session.path === state.currentSessionPath)
		return state.activityText ? "running" : undefined;
	return session.backgroundStatus;
}

export type AppTreeEntry = {
	id: string;
	parentId: string | null;
	prefix: string;
	label?: string;
	kind: "user" | "assistant" | "tool" | "summary" | "other";
	role: string;
	text: string;
	meta: string;
	metaTimestamp?: string;
	active: boolean;
	inPath: boolean;
};
export type AppUsageLimitWindow = {
	label: string;
	usedPercent: number;
	remainingPercent: number;
	resetText: string;
};
export type AppUsageLimits = {
	label: string;
	status?: string;
	windows: readonly AppUsageLimitWindow[];
};
export type AppUsage = {
	text: string;
	costText: string;
	contextPercent?: number;
	contextTokens?: number;
	contextWindow?: number;
	cacheHitPercent?: number;
	compactionCount?: number;
	limits?: Readonly<AppUsageLimits>;
};
export type AppKeybindHint = { keys: string; description: string };

export type UiCommitEffect =
	| { type: "script"; script: string }
	| { type: "render-transcript" }
	| { type: "signal-overrides"; values: JsonObject };

export interface AppStorePresentation {
	requestCommit(effect?: UiCommitEffect): void;
	messageAppended(): void;
	messagesRemoved(ids: readonly string[]): void;
	messageUpdated(id: string): void;
	streamingMessageChanged(id: string): void;
	sessionTransitionChanged(): void;
	assistantFinished(ids: { assistantId?: string; thoughtId?: string }): void;
	/** Discards message presentation, runs the replacement, and restarts rendering. */
	transcriptReplaced(replace: () => void, restored: boolean): void;
}

/** Read view of AppStore that renderers depend on. */
export type AppStateSnapshot = Readonly<{
	messages: readonly TranscriptMessage[];
	models: readonly AppModel[];
	modelsRevision: number;
	sessions: readonly AppSessionSummary[];
	sessionsHasMore: boolean;
	sessionCatalogLoading: boolean;
	slashCommands: readonly AppSlashCommand[];
	authDialog: AppAuthDialog | undefined;
	extensionDialog: AppExtensionDialog | undefined;
	extensionStatuses: readonly AppExtensionStatus[];
	extensionWidgets: readonly AppExtensionWidget[];
	extensionWorkingIndicator: string | undefined;
	extensionWorkingMessage: string | undefined;
	extensionWorkingVisible: boolean;
	llamaDialog: AppLlamaDialog | undefined;
	currentModel: string | undefined;
	currentSessionPath: string | undefined;
	previousSessionPath: string | undefined;
	isTemporarySession: boolean;
	thinkingLevel: AppThinkingLevel;
	thinkingLevels: readonly AppThinkingLevel[];
	thinkingHidden: boolean;
	theme: "system" | "light" | "dark";
	keybindHints: boolean;
	minimalMode: boolean;
	toolOutputHidden: boolean;
	toolbarHidden: boolean;
	sessionSidebarArchive: boolean;
	sessionSidebarArchiveAfterDays: number;
	usage: Readonly<AppUsage>;
	activityText: string | undefined;
	queuedSteeringMessages: readonly string[];
	queuedFollowUpMessages: readonly string[];
	workspacePath: string;
	projectRoot: string;
	workspaceFilesRevision: number;
	workspaceTreeRevision: number;
	workspaceReview: WorkspaceReviewSnapshot;
	workspaceReviewPreferences: WorkspaceReviewPreferences;
	recentWorkspaces: readonly string[];
	sessionTransition: SessionTransitionState;
	debugUi: boolean;
	datastarInspector: boolean;
	documentTitle: string;
	updateAvailable: AvailableUpdate | undefined;
	hasOlderMessages: boolean;
	promptHistory: readonly string[];
	promptEditorText: string;
	promptSessionKey: string;
	emptyChatHint: Readonly<AppKeybindHint>;
}>;

type AppStoreUpdateOptions = { commit?: boolean };

const sessionSidebarPageSize = 30;

function emptyChatHints(): AppKeybindHint[] {
	const commandHints = appCommandCatalog.flatMap((command) => {
		const shortcut = activeKeybind(command.id);
		return shortcut
			? [{ keys: formatShortcut(shortcut), description: command.description }]
			: [];
	});
	return [
		...commandHints,
		{ keys: "@", description: "Attach a file path." },
		{ keys: "/", description: "Open slash commands and skills." },
	];
}

function randomEmptyChatHint(): AppKeybindHint {
	const hints = emptyChatHints();
	return hints[Math.floor(Math.random() * hints.length)];
}
function debugUiEnabled(): boolean {
	return process.env.PI_UI_DEBUG === "1";
}
function datastarInspectorEnabled(): boolean {
	return process.env.PI_UI_INSPECTOR === "1";
}

/** Mutable authoritative application state. It has no renderer or transport dependency. */
export class AppStore {
	readonly transcript = new TranscriptState(randomEmptyChatHint());
	private presentation: AppStorePresentation | undefined;
	readonly debugUi = debugUiEnabled();
	readonly datastarInspector = datastarInspectorEnabled();
	documentTitle = "pi-ui";
	updateAvailable: AvailableUpdate | undefined;
	promptEditorText = "";
	promptSessionKey = "";
	models: AppModel[] = [];
	modelsRevision = 0;
	sessionCatalogLoading = true;
	sessionsRevision = 0;
	private sessionCatalog: AppSessionSummary[] = [];
	private sessionLimit = sessionSidebarPageSize;
	slashCommands: AppSlashCommand[] = [];
	authDialog: AppAuthDialog | undefined;
	extensionDialog: AppExtensionDialog | undefined;
	extensionStatuses: AppExtensionStatus[] = [];
	extensionWidgets: AppExtensionWidget[] = [];
	extensionWorkingIndicator: string | undefined;
	extensionWorkingMessage: string | undefined;
	extensionWorkingVisible = true;
	llamaDialog: AppLlamaDialog | undefined;
	currentModel: string | undefined;
	currentSessionPath: string | undefined;
	previousSessionPath: string | undefined;
	isTemporarySession = false;
	thinkingLevel: AppThinkingLevel = "off";
	thinkingLevels: AppThinkingLevel[] = ["off"];
	thinkingHidden = false;
	theme: AppStateSnapshot["theme"] = "system";
	keybindHints = true;
	minimalMode = false;
	toolOutputHidden = false;
	toolbarHidden = false;
	sessionSidebarOpen = true;
	sessionSidebarWidth = sessionSidebarWidthDefault;
	sessionSidebarArchive = true;
	sessionSidebarArchiveAfterDays = sessionSidebarArchiveAfterDaysDefault;
	usage: AppUsage = { text: "$0.000 • 0 tokens", costText: "$0.000" };
	workspacePath = defaultWorkspacePath();
	projectRoot = this.workspacePath;
	workspaceFilesRevision = 0;
	workspaceTreeRevision = 0;
	workspaceReview = unloadedWorkspaceReviewSnapshot;
	workspaceReviewPreferences: WorkspaceReviewPreferences = {};
	recentWorkspaces: string[] = [];
	prepareWorkspace?: (path: string) => Promise<WorkspaceReviewSnapshot>;
	private workspacePathListener: ((path: string) => void) | undefined;
	sessionTransition: SessionTransitionState = { status: "idle", generation: 0 };

	attachPresentation(presentation: AppStorePresentation): void {
		if (this.presentation) throw new Error("AppStore presentation already attached");
		this.presentation = presentation;
	}
	listenForWorkspacePath(listener: (path: string) => void): void {
		if (this.workspacePathListener)
			throw new Error("AppStore workspace path listener already attached");
		this.workspacePathListener = listener;
	}
	get messages(): readonly TranscriptMessage[] {
		return this.transcript.messages;
	}
	get sessions(): readonly AppSessionSummary[] {
		return this.orderedSessions.slice(0, this.sessionLimit);
	}
	private get orderedSessions(): AppSessionSummary[] {
		const running: AppSessionSummary[] = [];
		const completed: AppSessionSummary[] = [];
		const idle: AppSessionSummary[] = [];
		for (const session of this.sessionCatalog) {
			const status = sessionStatus(session, this);
			if (status === "running") running.push(session);
			else if (status === "completed") completed.push(session);
			else idle.push(session);
		}
		return completed.concat(running, idle);
	}
	get sessionsHasMore(): boolean {
		return (
			!this.sessionCatalogLoading && this.sessionLimit < this.sessionCatalog.length
		);
	}
	get hasOlderMessages(): boolean {
		return this.transcript.hasOlderMessages;
	}
	get promptHistory(): readonly string[] {
		return this.transcript.promptHistory;
	}
	get emptyChatHint(): AppKeybindHint {
		return this.transcript.emptyChatHint;
	}
	get activityText(): string | undefined {
		return this.transcript.activityText;
	}
	get queuedSteeringMessages(): readonly string[] {
		return [...this.transcript.queuedSteeringMessages];
	}
	get queuedFollowUpMessages(): readonly string[] {
		return [...this.transcript.queuedFollowUpMessages];
	}

	update<T>(mutator: () => T, options: AppStoreUpdateOptions = {}): T {
		try {
			return mutator();
		} finally {
			if (options.commit !== false) this.commit();
		}
	}
	private commit(effect?: UiCommitEffect): void {
		this.presentation?.requestCommit(effect);
	}

	appendMessage(
		role: TranscriptMessage["role"],
		text: string,
		options: TranscriptMessageOptions = {},
	): string {
		const id = this.transcript.appendMessage(role, text, options);
		this.presentation?.messageAppended();
		return id;
	}
	getMessage(id: string): TranscriptMessage | undefined {
		return this.transcript.getMessage(id);
	}

	updateMessage(id: string, patch: Partial<Omit<TranscriptMessage, "id">>): void {
		if (!this.transcript.updateMessage(id, patch)) return;
		this.presentation?.messageUpdated(id);
	}
	syncStreamingText(role: "thought" | "assistant", text: string): void {
		const existingId =
			role === "thought"
				? this.transcript.activeThoughtMessageId
				: this.transcript.activeAssistantMessageId;
		const previousText = existingId
			? this.transcript.getMessage(existingId)?.text
			: undefined;
		const id = this.transcript.syncStreamingText(role, text);
		if (!existingId) this.presentation?.messageAppended();
		else if (previousText !== text) this.presentation?.streamingMessageChanged(id);
	}
	finishAssistant(): void {
		const ids = this.transcript.finishAssistant();
		this.presentation?.assistantFinished(ids);
	}
	snapshotChat(): AppChatSnapshot {
		return this.transcript.snapshot();
	}
	/** A restored transcript keeps its message ids, so the reader can return to a saved row. */
	private replaceTranscript(replace: () => void, restored = false): void {
		if (this.presentation) this.presentation.transcriptReplaced(replace, restored);
		else replace();
	}
	restoreChat(snapshot: AppChatSnapshot): void {
		this.replaceTranscript(() => this.transcript.restore(snapshot), true);
		this.commit();
	}
	resetChat(options: { preserveEmptyHint?: boolean; broadcast?: boolean } = {}): void {
		this.replaceTranscript(() =>
			this.transcript.reset(
				options.preserveEmptyHint ? undefined : randomEmptyChatHint(),
			),
		);
		if (options.broadcast !== false) this.commit();
	}
	replaceMessages(messages: TranscriptMessageInput[]): void {
		this.replaceTranscript(() =>
			this.transcript.replaceMessages(
				messages,
				messages.length === 0 ? randomEmptyChatHint() : undefined,
			),
		);
		this.commit();
	}
	showRecentMessages(): void {
		let changed = false;
		this.replaceTranscript(() => {
			changed = this.transcript.showRecentMessages();
		});
		if (changed)
			this.commit({ type: "script", script: clientScripts.scrollTranscriptBottom });
	}
	loadOlderMessages(): readonly TranscriptMessage[] {
		return this.transcript.loadOlderMessages();
	}
	trimOldMessages(firstId: string, throughId: string): void {
		const removed = this.transcript.trimOldMessages(firstId, throughId);
		if (removed.length > 0) this.presentation?.messagesRemoved(removed);
	}
	setModels(models: AppModel[], currentModel: string | undefined): void {
		if (this.currentModel === currentModel && Bun.deepEquals(this.models, models)) {
			return;
		}
		this.models = models;
		this.currentModel = currentModel;
		this.modelsRevision += 1;
		this.commit();
	}
	setThinking(level: AppThinkingLevel, levels: AppThinkingLevel[]): void {
		this.thinkingLevel = level;
		this.thinkingLevels = levels.length > 0 ? levels : ["off"];
		this.commit();
	}
	setThinkingHidden(hidden: boolean): void {
		if (this.thinkingHidden === hidden) return;
		this.thinkingHidden = hidden;
		this.commit();
	}
	setSessionCatalogLoading(loading: boolean): void {
		if (this.sessionCatalogLoading === loading) return;
		this.sessionCatalogLoading = loading;
		this.sessionsRevision += 1;
		this.commit();
	}
	setSessionCatalog(sessions: AppSessionSummary[]): void {
		this.sessionCatalog = sessions;
		this.sessionsRevision += 1;
		this.commit();
	}
	loadMoreSessions(): void {
		this.sessionLimit = Math.min(
			this.sessionLimit + sessionSidebarPageSize,
			this.getSessionCatalog().length,
		);
		this.sessionsRevision += 1;
		this.commit();
	}
	getSessionCatalog(): readonly AppSessionSummary[] {
		return this.sessionCatalog;
	}
	promoteSession(path: string, options: { regroup?: boolean } = {}): boolean {
		const catalog = this.getSessionCatalog();
		const index = catalog.findIndex((candidate) => candidate.path === path);
		if (index < 0) return false;
		if (index === 0) {
			if (options.regroup) {
				this.sessionsRevision += 1;
				this.commit();
			}
			return false;
		}
		this.sessionCatalog = [catalog[index], ...catalog.toSpliced(index, 1)];
		this.sessionsRevision += 1;
		this.commit();
		return true;
	}
	updateSessionSummary(
		path: string,
		update: (session: AppSessionSummary) => AppSessionSummary,
	): boolean {
		const catalog = this.getSessionCatalog();
		const index = catalog.findIndex((candidate) => candidate.path === path);
		if (index < 0) return false;
		this.sessionCatalog = catalog.with(index, update(catalog[index]));
		this.sessionsRevision += 1;
		this.commit();
		return true;
	}
	searchSessions(query: string): AppSessionSummary[] {
		const normalized = query.trim().toLowerCase();
		if (!normalized) return [...this.sessions];
		const terms = normalized.split(/\s+/);
		return this.orderedSessions
			.values()
			.filter((session) => {
				const haystack =
					`${session.title} ${formatMessageCount(session.messageCount)} ${session.cwd} ${session.path}`.toLowerCase();
				return terms.every((term) => haystack.includes(term));
			})
			.take(this.sessionLimit)
			.toArray();
	}
	removeSession(path: string): void {
		this.setSessionCatalog(
			this.getSessionCatalog().filter((session) => session.path !== path),
		);
	}
	setRecentWorkspaces(values: string[]): void {
		this.recentWorkspaces = uniqueStrings([
			...values.filter((path) => !managedWorktreeParts(path)),
			...this.recentWorkspaces,
		]);
		this.commit();
	}
	setSlashCommands(commands: AppSlashCommand[]): void {
		this.slashCommands = commands;
		this.commit();
	}
	setAuthDialog(dialog: AppAuthDialog | undefined): void {
		this.authDialog = dialog;
		this.commit();
	}
	setExtensionDialog(dialog: AppExtensionDialog | undefined): void {
		this.extensionDialog = dialog;
		this.commit();
	}
	setExtensionStatuses(statuses: AppExtensionStatus[]): void {
		this.extensionStatuses = statuses.map((status) => ({ ...status }));
		this.commit();
	}
	setExtensionWidgets(widgets: AppExtensionWidget[]): void {
		this.extensionWidgets = widgets.map((widget) => ({
			...widget,
			lines: [...widget.lines],
		}));
		this.commit();
	}
	setExtensionWorking(options: {
		message?: string;
		visible: boolean;
		indicator?: string;
	}): void {
		this.extensionWorkingMessage = options.message;
		this.extensionWorkingVisible = options.visible;
		this.extensionWorkingIndicator = options.indicator;
		this.commit();
	}
	setDocumentTitle(title: string): void {
		this.documentTitle = title;
		this.commit();
	}
	/** Keeps the editor mirror in the current session. Drafts stay in the browser. */
	setPromptSessionKey(key: string): void {
		if (key === this.promptSessionKey) return;
		this.promptSessionKey = key;
		this.setPromptEditorText("", { broadcast: false });
	}
	setPromptEditorText(text: string, options: { broadcast?: boolean } = {}): void {
		this.promptEditorText = text;
		if (options.broadcast !== false) {
			this.presentation?.requestCommit({
				type: "signal-overrides",
				values: { prompt: text },
			});
		}
	}
	setLlamaDialog(dialog: AppLlamaDialog | undefined): void {
		this.llamaDialog = dialog;
		this.commit();
	}
	openTreeDialog(): void {
		this.commit({ type: "script", script: clientScripts.openTreeDialog });
	}
	setUsage(value: AppUsage): void {
		this.usage = value;
		this.commit();
	}
	setActivityText(value: string | undefined): void {
		if (this.activityText === value) return;
		this.transcript.setActivityText(value);
		this.commit();
	}
	setQueuedMessages(steering: readonly string[], followUp: readonly string[]): void {
		this.transcript.setQueuedMessages(steering, followUp);
		this.commit();
	}
	setCurrentSessionPath(value: string | undefined): void {
		// Switching between persisted sessions keeps the outgoing one reachable.
		if (value && value !== this.currentSessionPath && this.currentSessionPath) {
			this.previousSessionPath = this.currentSessionPath;
		}
		this.currentSessionPath = value;
		this.commit();
	}
	setPreviousSessionPath(value: string | undefined): void {
		if (this.previousSessionPath === value) return;
		this.previousSessionPath = value;
		this.commit();
	}
	setTemporarySession(value: boolean): void {
		this.isTemporarySession = value;
		this.commit();
	}
	setUpdateAvailable(value: AvailableUpdate): void {
		this.updateAvailable = value;
		this.commit();
	}
	setWorkspacePath(value: string, prepared?: WorkspaceReviewSnapshot): void {
		if (this.workspacePath === value) {
			if (prepared) this.setWorkspaceReview(prepared);
			return;
		}
		this.workspacePath = value;
		this.workspaceFilesRevision = 0;
		this.workspaceTreeRevision = 0;
		this.workspaceReview = prepared ?? unloadedWorkspaceReviewSnapshot;
		this.commit();
		this.workspacePathListener?.(value);
	}
	setProjectRoot(value: string): void {
		if (this.projectRoot === value) return;
		this.projectRoot = value;
		this.commit();
	}
	workspaceFilesChanged(treeChanged = true): void {
		if (this.workspaceReview.initialView) {
			this.workspaceReview = { ...this.workspaceReview, initialView: undefined };
		}
		this.workspaceFilesRevision += 1;
		if (treeChanged) this.workspaceTreeRevision += 1;
		this.commit();
	}
	setWorkspaceReview(value: WorkspaceReviewSnapshot): void {
		if (this.workspaceReview.revision === value.revision) return;
		this.workspaceReview = value;
		this.commit();
	}
	setWorkspaceReviewPreferences(value: WorkspaceReviewPreferences): void {
		this.workspaceReviewPreferences = value;
		this.commit();
	}
	setSessionTransition(value: SessionTransitionState): void {
		this.sessionTransition = value;
		this.presentation?.sessionTransitionChanged();
	}
}
