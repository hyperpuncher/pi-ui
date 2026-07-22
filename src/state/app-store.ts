import type { SessionTransitionState } from "../agent/session-transition-controller.ts";
import { appCommandCatalog } from "../commands/catalog.ts";
import { sessionPerformance } from "../perf/session-performance.ts";
import { formatShortcut } from "../utils/keyboard.ts";
import { defaultWorkspacePath } from "../utils/workspace.ts";
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
export type AppMessageInput = TranscriptMessageInput & { renderedHtml?: string };
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
export type AppKeybindHint = { keys: string; description: string };

export type UiCommitEffect =
	| { type: "reopen-model-picker" }
	| { type: "auth-dialog"; open: boolean }
	| { type: "scroll-messages-to-bottom" }
	| { type: "signal-overrides"; values: Readonly<Record<string, unknown>> };

export interface AppStorePresentation {
	beginUpdate(): void;
	endUpdate(commit: boolean, flush: boolean): void;
	requestCommit(effect?: UiCommitEffect): void;
	flush(): void;
	suppressMessages<T>(callback: () => Promise<T>): Promise<T>;
	messageAppended(id: string): void;
	messageUpdated(id: string): void;
	streamingMessageStarted(id: string): void;
	streamingMessageChanged(): void;
	assistantFinished(ids: { assistantId?: string; thoughtId?: string }): void;
	transcriptReplacing(): void;
	transcriptReplaced(
		activeIds: readonly (string | undefined)[],
		enhancementIds: readonly string[],
	): void;
	scheduleEnhancements(ids: readonly string[]): void;
	projectMessages(messages: readonly TranscriptMessage[]): AppMessage[];
}

export type AppRenderSnapshot = Readonly<{
	messages: readonly AppMessage[];
	models: readonly AppModel[];
	sessions: readonly AppSessionSummary[];
	treeEntries: readonly AppTreeEntry[];
	slashCommands: readonly AppSlashCommand[];
	authDialog: AppAuthDialog | undefined;
	currentModel: string | undefined;
	currentSessionPath: string | undefined;
	isTemporarySession: boolean;
	thinkingLevel: AppThinkingLevel;
	thinkingLevels: readonly AppThinkingLevel[];
	usage: Readonly<AppUsage>;
	activityText: string | undefined;
	queuedSteeringMessages: readonly string[];
	queuedFollowUpMessages: readonly string[];
	workspacePath: string;
	recentWorkspaces: readonly string[];
	sessionTransition: SessionTransitionState;
	debugUi: boolean;
	datastarInspector: boolean;
	hasOlderMessages: boolean;
	promptHistory: readonly string[];
	emptyChatHint: Readonly<AppKeybindHint>;
}>;

type AppStoreUpdateOptions = { flush?: boolean; commit?: boolean };

const SESSION_PICKER_RECENT_LIMIT = 50;

const emptyChatHints: AppKeybindHint[] = [
	...appCommandCatalog
		.filter((command) => command.shortcut.display)
		.map((command) => ({
			keys: formatShortcut(command.shortcut.display),
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
	return Deno.env.get("PI_UI_DEBUG") === "1";
}
function datastarInspectorEnabled(): boolean {
	return Deno.env.get("PI_UI_INSPECTOR") === "1";
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
	models: AppModel[] = [];
	sessions: AppSessionSummary[] = [];
	private sessionIndex: AppSessionSummary[] | undefined;
	treeEntries: AppTreeEntry[] = [];
	slashCommands: AppSlashCommand[] = [];
	authDialog: AppAuthDialog | undefined;
	currentModel: string | undefined;
	currentSessionPath: string | undefined;
	isTemporarySession = false;
	thinkingLevel: AppThinkingLevel = "off";
	thinkingLevels: AppThinkingLevel[] = ["off"];
	usage: AppUsage = { text: "$0.000 • 0 tokens" };
	workspacePath = defaultWorkspacePath();
	recentWorkspaces: string[] = [];
	sessionTransition: SessionTransitionState = { status: "idle", generation: 0 };

	attachPresentation(presentation: AppStorePresentation): void {
		if (this.presentation) throw new Error("AppStore presentation already attached");
		this.presentation = presentation;
	}
	get messages(): AppMessage[] {
		return (
			this.presentation?.projectMessages(this.transcript.messages) ??
			this.transcript.messages.map((message) => ({
				...message,
				presentationState: "plain",
				presentationVersion: 0,
			}))
		);
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

	snapshot(): AppRenderSnapshot {
		return Object.freeze({
			messages: this.messages.map((message) => ({ ...message })),
			models: this.models.map((model) => ({ ...model })),
			sessions: this.sessions.map((session) => ({ ...session })),
			treeEntries: this.treeEntries.map((entry) => ({ ...entry })),
			slashCommands: this.slashCommands.map((command) => ({ ...command })),
			authDialog: this.authDialog ? structuredClone(this.authDialog) : undefined,
			currentModel: this.currentModel,
			currentSessionPath: this.currentSessionPath,
			isTemporarySession: this.isTemporarySession,
			thinkingLevel: this.thinkingLevel,
			thinkingLevels: [...this.thinkingLevels],
			usage: { ...this.usage },
			activityText: this.activityText,
			queuedSteeringMessages: [...this.queuedSteeringMessages],
			queuedFollowUpMessages: [...this.queuedFollowUpMessages],
			workspacePath: this.workspacePath,
			recentWorkspaces: [...this.recentWorkspaces],
			sessionTransition: { ...this.sessionTransition },
			debugUi: this.debugUi,
			datastarInspector: this.datastarInspector,
			hasOlderMessages: this.hasOlderMessages,
			promptHistory: [...this.promptHistory],
			emptyChatHint: { ...this.emptyChatHint },
		});
	}

	async suppressMessagePatches<T>(callback: () => Promise<T>): Promise<T> {
		return this.presentation
			? await this.presentation.suppressMessages(callback)
			: await callback();
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
		role: AppMessage["role"],
		text: string,
		options: AppMessageOptions = {},
	): string {
		const id = this.transcript.appendMessage(role, text, options);
		this.presentation?.messageAppended(id);
		this.commit();
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
		this.presentation?.messageUpdated(id);
		this.commit();
	}
	appendThoughtDelta(delta: string): void {
		const previousId = this.transcript.activeThoughtMessageId;
		const id = this.transcript.appendThoughtDelta(delta);
		if (!previousId) {
			this.presentation?.streamingMessageStarted(id);
			this.commit();
		} else this.presentation?.streamingMessageChanged();
	}
	appendAssistantDelta(delta: string): void {
		const previousId = this.transcript.activeAssistantMessageId;
		const id = this.transcript.appendAssistantDelta(delta);
		if (!previousId) {
			this.presentation?.streamingMessageStarted(id);
			this.commit();
		} else this.presentation?.streamingMessageChanged();
	}
	finishAssistant(): void {
		const ids = this.transcript.finishAssistant();
		this.presentation?.assistantFinished(ids);
		this.commit();
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
			messages.map(({ renderedHtml: _, ...message }) => message),
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
	loadOlderMessages(options: { broadcast?: boolean } = {}): boolean {
		const ids = this.transcript.loadOlderMessages();
		if (ids.length === 0) return false;
		if (options.broadcast !== false) this.commit();
		this.presentation?.scheduleEnhancements(ids);
		return true;
	}
	setModels(
		models: AppModel[],
		currentModel: string | undefined,
		options: { reopenPicker?: boolean } = {},
	): void {
		this.models = models;
		this.currentModel = currentModel;
		this.commit(options.reopenPicker ? { type: "reopen-model-picker" } : undefined);
	}
	setThinking(level: AppThinkingLevel, levels: AppThinkingLevel[]): void {
		this.thinkingLevel = level;
		this.thinkingLevels = levels.length > 0 ? levels : ["off"];
		this.commit();
	}
	setSessions(sessions: AppSessionSummary[]): void {
		this.sessions = sessions;
		this.commit();
	}
	setSessionCatalog(sessions: AppSessionSummary[]): void {
		this.sessionIndex = sessions;
		this.sessions = sessions.slice(0, SESSION_PICKER_RECENT_LIMIT);
		this.commit();
	}
	getSessionCatalog(): readonly AppSessionSummary[] {
		return this.sessionIndex ?? this.sessions;
	}
	searchSessions(query: string): AppSessionSummary[] {
		const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
		if (terms.length === 0) return [...this.sessions];
		return this.getSessionCatalog().filter((session) => {
			const haystack =
				`${session.title} ${session.subtitle} ${session.cwd} ${session.path}`.toLowerCase();
			return terms.every((term) => haystack.includes(term));
		});
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
		]).slice(0, 8);
		this.commit();
	}
	setSlashCommands(commands: AppSlashCommand[]): void {
		this.slashCommands = commands;
		this.commit();
	}
	setAuthDialog(
		dialog: AppAuthDialog | undefined,
		options: { resetInput?: boolean } = {},
	): void {
		this.authDialog = dialog;
		this.presentation?.requestCommit({ type: "auth-dialog", open: Boolean(dialog) });
		if (options.resetInput)
			this.presentation?.requestCommit({
				type: "signal-overrides",
				values: { authInput: "" },
			});
	}
	setTreeEntries(entries: AppTreeEntry[]): void {
		this.treeEntries = entries;
		this.commit();
	}
	setCurrentModel(value: string | undefined): void {
		this.currentModel = value;
		this.commit();
	}
	setUsage(value: AppUsage): void {
		this.usage = value;
		this.commit();
	}
	setActivityText(value: string | undefined): void {
		this.transcript.setActivityText(value);
		this.commit();
	}
	setQueuedMessages(steering: readonly string[], followUp: readonly string[]): void {
		this.transcript.setQueuedMessages(steering, followUp);
		this.commit();
	}
	setCurrentSessionPath(value: string | undefined): void {
		this.currentSessionPath = value;
		this.commit();
	}
	setTemporarySession(value: boolean): void {
		this.isTemporarySession = value;
		this.commit();
	}
	setWorkspacePath(value: string): void {
		this.workspacePath = value;
		this.commit();
	}
	setSessionTransition(value: SessionTransitionState): void {
		const loaded =
			this.sessionTransition.status === "loading" && value.status === "idle";
		if (this.sessionTransition.status === "loading" && value.status !== "loading")
			this.flush();
		this.sessionTransition = value;
		this.commit(loaded ? { type: "scroll-messages-to-bottom" } : undefined);
		this.flush();
	}
}
