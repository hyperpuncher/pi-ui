import type { SessionTransitionState } from "../agent/session-transition-controller.ts";
import { appCommandCatalog } from "../commands/catalog.ts";
import { sessionPerformance } from "../perf/session-performance.ts";
import type { JsonObject } from "../utils/json-types.ts";
import { formatShortcut } from "../utils/keyboard.ts";
import { defaultWorkspacePath } from "../utils/workspace.ts";
import {
	type WorkspaceReviewPreferences,
	type WorkspaceReviewSnapshot,
	unloadedWorkspaceReviewSnapshot,
} from "../workspace-review-types.ts";
import {
	TranscriptState,
	type TranscriptMessage,
	type TranscriptMessageInput,
	type TranscriptMessageOptions,
	type TranscriptMessageTitlePart,
	type TranscriptSnapshot,
} from "./transcript-state.ts";

export type AppMessageTitlePart = TranscriptMessageTitlePart;
export type AppMessageOptions = TranscriptMessageOptions;
export type AppChatSnapshot = TranscriptSnapshot;
export type AppMessageInput = TranscriptMessageInput;
export type AppModel = {
	id: string;
	provider: string;
	name: string;
	configured: boolean;
	scoped: boolean;
};
export type AppThinkingLevel =
	| "off"
	| "minimal"
	| "low"
	| "medium"
	| "high"
	| "xhigh"
	| "max";
export type AppSlashCommand = {
	name: string;
	description: string;
	source: "prompt" | "skill" | "extension" | "system";
	argumentHint?: string;
};
export type AppAuthProvider = { id: string; name: string; authType: "oauth" | "api_key" };
export type AppAuthPrompt = {
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
	subtitle: string;
	modified: string;
	modifiedAt?: string;
	backgroundStatus?: BackgroundSessionStatus;
};
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
	limits?: Readonly<AppUsageLimits>;
};
export type AppKeybindHint = { keys: string; description: string };

export type UiCommitEffect =
	| { type: "restore-model-picker" }
	| {
			type: "dialog";
			id: "auth-dialog" | "extension-dialog" | "llama-dialog";
			open: boolean;
	  }
	| { type: "document-title"; title: string }
	| { type: "signal-overrides"; values: JsonObject };

export interface AppStorePresentation {
	beginUpdate(): void;
	endUpdate(commit: boolean, flush: boolean): void;
	requestCommit(effect?: UiCommitEffect): void;
	flush(): void;
	messageAppended(id: string): void;
	messageUpdated(id: string): void;
	pickersChanged(): void;
	sessionsChanged(): void;
	workspaceReviewChanged(): void;
	streamingMessageStarted(id: string): void;
	streamingMessageChanged(): void;
	sessionTransitionChanged(scrollToBottom: boolean): void;
	assistantFinished(ids: { assistantId?: string; thoughtId?: string }): void;
	transcriptReplacing(): void;
	transcriptReplaced(
		activeIds: readonly (string | undefined)[],
		enhancementIds: readonly string[],
	): void;
}

export type AppStateSnapshot = Readonly<{
	messages: readonly TranscriptMessage[];
	models: readonly AppModel[];
	sessions: readonly AppSessionSummary[];
	sessionSidebarSessions: readonly AppSessionSummary[];
	sessionSidebarHasMore: boolean;
	sessionCatalogLoading: boolean;
	treeEntries: readonly AppTreeEntry[];
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
	isTemporarySession: boolean;
	thinkingLevel: AppThinkingLevel;
	thinkingLevels: readonly AppThinkingLevel[];
	thinkingHidden: boolean;
	usage: Readonly<AppUsage>;
	activityText: string | undefined;
	queuedSteeringMessages: readonly string[];
	queuedFollowUpMessages: readonly string[];
	workspacePath: string;
	workspaceFilesRevision: number;
	workspaceReview: WorkspaceReviewSnapshot;
	workspaceReviewPreferences: WorkspaceReviewPreferences;
	recentWorkspaces: readonly string[];
	sessionTransition: SessionTransitionState;
	debugUi: boolean;
	datastarInspector: boolean;
	documentTitle: string;
	hasOlderMessages: boolean;
	promptHistory: readonly string[];
	promptEditorText: string;
	emptyChatHint: Readonly<AppKeybindHint>;
}>;

type AppStoreUpdateOptions = { flush?: boolean; commit?: boolean };

const SESSION_PICKER_RECENT_LIMIT = 50;
export const sessionSidebarPageSize = 30;

const emptyChatHints: AppKeybindHint[] = [
	...appCommandCatalog
		.filter((command) => command.shortcut)
		.map((command) => ({
			keys: formatShortcut(command.shortcut),
			description: command.description,
		})),
	{ keys: "alt T", description: "Cycle thinking level." },
	{ keys: "@", description: "Attach a file path." },
	{ keys: "/", description: "Open slash commands and skills." },
];

function randomEmptyChatHint(): AppKeybindHint {
	return emptyChatHints[Math.floor(Math.random() * emptyChatHints.length)];
}
function debugUiEnabled(): boolean {
	return process.env.PI_UI_DEBUG === "1";
}
function datastarInspectorEnabled(): boolean {
	return process.env.PI_UI_INSPECTOR === "1";
}
function uniqueStrings(values: string[]): string[] {
	const unique: string[] = [];
	for (const value of values) if (value && !unique.includes(value)) unique.push(value);
	return unique;
}

/** Mutable authoritative application state. It has no renderer or transport dependency. */
export class AppStore {
	readonly transcript = new TranscriptState(randomEmptyChatHint());
	private presentation: AppStorePresentation | undefined;
	readonly debugUi = debugUiEnabled();
	readonly datastarInspector = datastarInspectorEnabled();
	documentTitle = "pi-ui";
	promptEditorText = "";
	models: AppModel[] = [];
	sessions: AppSessionSummary[] = [];
	sessionCatalogLoading = true;
	private sessionIndex: AppSessionSummary[] | undefined;
	private sessionSidebarLimit = sessionSidebarPageSize;
	treeEntries: AppTreeEntry[] = [];
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
	isTemporarySession = false;
	thinkingLevel: AppThinkingLevel = "off";
	thinkingLevels: AppThinkingLevel[] = ["off"];
	thinkingHidden = false;
	usage: AppUsage = { text: "$0.000 • 0 tokens", costText: "$0.000" };
	workspacePath = defaultWorkspacePath();
	workspaceFilesRevision = 0;
	workspaceReview = unloadedWorkspaceReviewSnapshot;
	workspaceReviewPreferences: WorkspaceReviewPreferences = {};
	recentWorkspaces: string[] = [];
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
	get hasOlderMessages(): boolean {
		return this.transcript.hasOlderMessages;
	}
	get promptHistory(): readonly string[] {
		const history: string[] = [];
		for (const message of this.transcript.allMessages) {
			if (message.role !== "user") continue;
			const text = message.text.trim();
			if (!text || history[0] === text) continue;
			history.unshift(text);
			if (history.length > 100) history.pop();
		}
		return history;
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

	snapshot(): AppStateSnapshot {
		return Object.freeze({
			messages: this.messages.map((message) => ({ ...message })),
			models: this.models.map((model) => ({ ...model })),
			sessions: this.sessions.map((session) => ({ ...session })),
			sessionSidebarSessions: this.getSessionCatalog()
				.slice(0, this.sessionSidebarLimit)
				.map((session) => ({ ...session })),
			sessionSidebarHasMore:
				!this.sessionCatalogLoading &&
				this.sessionSidebarLimit < this.getSessionCatalog().length,
			sessionCatalogLoading: this.sessionCatalogLoading,
			treeEntries: this.treeEntries.map((entry) => ({ ...entry })),
			slashCommands: this.slashCommands.map((command) => ({ ...command })),
			authDialog: this.authDialog ? structuredClone(this.authDialog) : undefined,
			extensionDialog: this.extensionDialog
				? structuredClone(this.extensionDialog)
				: undefined,
			extensionStatuses: this.extensionStatuses.map((status) => ({ ...status })),
			extensionWidgets: this.extensionWidgets.map((widget) => ({
				...widget,
				lines: [...widget.lines],
			})),
			extensionWorkingIndicator: this.extensionWorkingIndicator,
			extensionWorkingMessage: this.extensionWorkingMessage,
			extensionWorkingVisible: this.extensionWorkingVisible,
			llamaDialog: this.llamaDialog ? structuredClone(this.llamaDialog) : undefined,
			currentModel: this.currentModel,
			currentSessionPath: this.currentSessionPath,
			isTemporarySession: this.isTemporarySession,
			thinkingLevel: this.thinkingLevel,
			thinkingLevels: [...this.thinkingLevels],
			thinkingHidden: this.thinkingHidden,
			usage: { ...this.usage },
			activityText: this.activityText,
			queuedSteeringMessages: [...this.queuedSteeringMessages],
			queuedFollowUpMessages: [...this.queuedFollowUpMessages],
			workspacePath: this.workspacePath,
			workspaceFilesRevision: this.workspaceFilesRevision,
			workspaceReview: structuredClone(this.workspaceReview),
			workspaceReviewPreferences: { ...this.workspaceReviewPreferences },
			recentWorkspaces: [...this.recentWorkspaces],
			sessionTransition: { ...this.sessionTransition },
			debugUi: this.debugUi,
			datastarInspector: this.datastarInspector,
			documentTitle: this.documentTitle,
			hasOlderMessages: this.hasOlderMessages,
			promptHistory: [...this.promptHistory],
			promptEditorText: this.promptEditorText,
			emptyChatHint: { ...this.emptyChatHint },
		});
	}

	update<T>(mutator: () => T, options: AppStoreUpdateOptions = {}): T {
		this.presentation?.beginUpdate();
		try {
			return mutator();
		} finally {
			this.presentation?.endUpdate(
				options.commit !== false,
				options.flush === true,
			);
		}
	}
	flush(): void {
		this.presentation?.flush();
	}
	private commit(effect?: UiCommitEffect): void {
		this.presentation?.requestCommit(effect);
	}

	appendMessage(
		role: TranscriptMessage["role"],
		text: string,
		options: AppMessageOptions = {},
	): string {
		const id = this.transcript.appendMessage(role, text, options);
		this.presentation?.messageAppended(id);
		return id;
	}
	updateMessage(id: string, patch: Partial<Omit<TranscriptMessage, "id">>): void {
		if (!this.transcript.updateMessage(id, patch)) return;
		this.presentation?.messageUpdated(id);
	}
	appendThoughtDelta(delta: string): void {
		const previousId = this.transcript.activeThoughtMessageId;
		const id = this.transcript.appendThoughtDelta(delta);
		if (!previousId) this.presentation?.streamingMessageStarted(id);
		else this.presentation?.streamingMessageChanged();
	}
	appendAssistantDelta(delta: string): void {
		const previousId = this.transcript.activeAssistantMessageId;
		const id = this.transcript.appendAssistantDelta(delta);
		if (!previousId) this.presentation?.streamingMessageStarted(id);
		else this.presentation?.streamingMessageChanged();
	}
	finishAssistant(): void {
		const ids = this.transcript.finishAssistant();
		this.presentation?.assistantFinished(ids);
	}
	snapshotChat(): AppChatSnapshot {
		return this.transcript.snapshot();
	}
	restoreChat(snapshot: AppChatSnapshot): void {
		const end = sessionPerformance.startSpan("transcriptProjection");
		this.presentation?.transcriptReplacing();
		this.transcript.restore(snapshot);
		end();
		sessionPerformance.markTranscriptProjected();
		this.presentation?.transcriptReplaced(
			[snapshot.activeThoughtId, snapshot.activeAssistantId],
			this.transcript.messages.map((message) => message.id),
		);
		this.commit();
	}
	resetChat(options: { preserveEmptyHint?: boolean; broadcast?: boolean } = {}): void {
		this.presentation?.transcriptReplacing();
		this.transcript.reset(
			options.preserveEmptyHint ? undefined : randomEmptyChatHint(),
		);
		this.presentation?.transcriptReplaced([], []);
		if (options.broadcast !== false) this.commit();
	}
	replaceMessages(messages: AppMessageInput[]): void {
		const end = sessionPerformance.startSpan("transcriptProjection");
		this.presentation?.transcriptReplacing();
		this.transcript.replaceMessages(
			messages,
			messages.length === 0 ? randomEmptyChatHint() : undefined,
		);
		end();
		sessionPerformance.markTranscriptProjected();
		this.presentation?.transcriptReplaced(
			[],
			this.transcript.messages.map((message) => message.id),
		);
		this.commit();
	}
	loadOlderMessages(): readonly string[] {
		return this.transcript.loadOlderMessages();
	}
	setModels(
		models: AppModel[],
		currentModel: string | undefined,
		options: { restorePicker?: boolean } = {},
	): void {
		this.models = models;
		this.currentModel = currentModel;
		this.presentation?.pickersChanged();
		this.commit(options.restorePicker ? { type: "restore-model-picker" } : undefined);
	}
	setThinking(level: AppThinkingLevel, levels: AppThinkingLevel[]): void {
		this.thinkingLevel = level;
		this.thinkingLevels = levels.length > 0 ? levels : ["off"];
		this.presentation?.pickersChanged();
		this.commit();
	}
	setThinkingHidden(hidden: boolean): void {
		if (this.thinkingHidden === hidden) return;
		this.thinkingHidden = hidden;
		this.commit();
	}
	setSessions(sessions: AppSessionSummary[]): void {
		this.sessions = sessions;
		this.presentation?.sessionsChanged();
		this.commit();
	}
	setSessionCatalogLoading(loading: boolean): void {
		if (this.sessionCatalogLoading === loading) return;
		this.sessionCatalogLoading = loading;
		this.presentation?.sessionsChanged();
		this.commit();
	}
	setSessionCatalog(sessions: AppSessionSummary[]): void {
		this.sessionIndex = sessions;
		this.sessions = sessions.slice(0, SESSION_PICKER_RECENT_LIMIT);
		this.presentation?.sessionsChanged();
		this.commit();
	}
	loadMoreSessions(): void {
		this.sessionSidebarLimit = Math.min(
			this.sessionSidebarLimit + sessionSidebarPageSize,
			this.getSessionCatalog().length,
		);
		this.presentation?.sessionsChanged();
		this.commit();
	}
	getSessionCatalog(): readonly AppSessionSummary[] {
		return this.sessionIndex ?? this.sessions;
	}
	promoteSession(path: string, options: { regroup?: boolean } = {}): boolean {
		const catalog = this.getSessionCatalog();
		const session = catalog.find((candidate) => candidate.path === path);
		if (!session) return false;
		if (catalog[0]?.path === path) {
			if (options.regroup) {
				this.presentation?.sessionsChanged();
				this.commit();
			}
			return false;
		}
		this.sessionIndex = [
			session,
			...catalog.filter((candidate) => candidate.path !== path),
		];
		this.sessions = this.sessionIndex.slice(0, SESSION_PICKER_RECENT_LIMIT);
		this.presentation?.sessionsChanged();
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
		const sessions = catalog.map((session, candidateIndex) =>
			candidateIndex === index ? update(session) : session,
		);
		this.sessionIndex = sessions;
		this.sessions = sessions.slice(0, SESSION_PICKER_RECENT_LIMIT);
		this.presentation?.sessionsChanged();
		this.commit();
		return true;
	}
	searchSessions(query: string): AppSessionSummary[] {
		const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
		if (terms.length === 0) return [...this.sessions];
		return this.getSessionCatalog()
			.filter((session) => {
				const haystack =
					`${session.title} ${session.subtitle} ${session.cwd} ${session.path}`.toLowerCase();
				return terms.every((term) => haystack.includes(term));
			})
			.slice(0, SESSION_PICKER_RECENT_LIMIT);
	}
	removeSession(path: string): void {
		this.setSessionCatalog(
			this.getSessionCatalog().filter((session) => session.path !== path),
		);
	}
	setRecentWorkspaces(values: string[]): void {
		this.recentWorkspaces = uniqueStrings([
			this.workspacePath,
			...values,
			...this.recentWorkspaces,
		]);
		this.presentation?.pickersChanged();
		this.commit();
	}
	setSlashCommands(commands: AppSlashCommand[]): void {
		this.slashCommands = commands;
		this.presentation?.pickersChanged();
		this.commit();
	}
	setAuthDialog(
		dialog: AppAuthDialog | undefined,
		options: { resetInput?: boolean } = {},
	): void {
		this.authDialog = dialog;
		this.presentation?.pickersChanged();
		this.presentation?.requestCommit({
			type: "dialog",
			id: "auth-dialog",
			open: Boolean(dialog),
		});
		if (options.resetInput)
			this.presentation?.requestCommit({
				type: "signal-overrides",
				values: { authInput: "" },
			});
	}
	setExtensionDialog(dialog: AppExtensionDialog | undefined): void {
		this.extensionDialog = dialog;
		this.presentation?.pickersChanged();
		this.presentation?.requestCommit({
			type: "dialog",
			id: "extension-dialog",
			open: Boolean(dialog),
		});
		if (dialog) {
			this.presentation?.requestCommit({
				type: "signal-overrides",
				values: {
					extensionRequestId: dialog.id,
					extensionResponse:
						dialog.kind === "input" || dialog.kind === "editor"
							? (dialog.prefill ?? "")
							: "",
				},
			});
		}
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
		this.presentation?.requestCommit({ type: "document-title", title });
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
		this.presentation?.pickersChanged();
		this.presentation?.requestCommit({
			type: "dialog",
			id: "llama-dialog",
			open: Boolean(dialog),
		});
	}
	setTreeEntries(entries: AppTreeEntry[]): void {
		this.treeEntries = entries;
		this.presentation?.pickersChanged();
		this.commit();
	}
	setUsage(value: AppUsage): void {
		this.usage = value;
		this.commit();
	}
	setActivityText(value: string | undefined): void {
		this.transcript.setActivityText(value);
		this.presentation?.sessionsChanged();
		this.commit();
	}
	setQueuedMessages(steering: readonly string[], followUp: readonly string[]): void {
		this.transcript.setQueuedMessages(steering, followUp);
		this.commit();
	}
	setCurrentSessionPath(value: string | undefined): void {
		this.currentSessionPath = value;
		this.presentation?.sessionsChanged();
		this.commit();
	}
	setTemporarySession(value: boolean): void {
		this.isTemporarySession = value;
		this.commit();
	}
	setWorkspacePath(value: string): void {
		if (this.workspacePath === value) return;
		this.workspacePath = value;
		this.workspaceFilesRevision = 0;
		this.workspaceReview = unloadedWorkspaceReviewSnapshot;
		this.presentation?.pickersChanged();
		this.presentation?.workspaceReviewChanged();
		this.commit();
		this.workspacePathListener?.(value);
	}
	workspaceFilesChanged(): void {
		this.workspaceFilesRevision += 1;
		this.presentation?.workspaceReviewChanged();
		this.commit();
	}
	setWorkspaceReview(value: WorkspaceReviewSnapshot): void {
		if (this.workspaceReview.revision === value.revision) return;
		this.workspaceReview = value;
		this.presentation?.workspaceReviewChanged();
		this.commit();
	}
	setWorkspaceReviewPreferences(value: WorkspaceReviewPreferences): void {
		this.workspaceReviewPreferences = value;
		this.presentation?.workspaceReviewChanged();
		this.commit();
	}
	setSessionTransition(value: SessionTransitionState): void {
		const loaded =
			this.sessionTransition.status === "loading" && value.status === "idle";
		this.flush();
		this.sessionTransition = value;
		this.presentation?.sessionTransitionChanged(loaded);
	}
}
