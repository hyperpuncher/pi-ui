import {
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
	getAgentDir,
	parseSkillBlock,
	SessionManager,
	type AgentSessionEvent,
	type AgentSessionRuntime,
	type CreateAgentSessionRuntimeFactory,
	type SessionEntry,
	type SessionInfo,
	type SessionTreeNode,
	type SessionStats,
} from "@earendil-works/pi-coding-agent";

import { AppState } from "../state/app-state.ts";
import type {
	AppMessageInput,
	AppMessageTitlePart,
	AppSessionSummary,
	AppThinkingLevel,
	AppTreeEntry,
	AppUsage,
} from "../state/app-state.ts";
import { applyHttpProxySetting, configureHttpDispatcher } from "../utils/http-proxy.ts";
import { formatDateTime } from "../utils/locale.ts";
import { defaultWorkspacePath, formatHomePath } from "../utils/workspace.ts";
import { CodexUsageRequestTracker } from "./codex-usage-request.ts";
import {
	codexUsageTtlMs,
	fetchCodexUsage,
	formatCodexUsage,
	isOpenAICodex,
	type CodexUsage,
} from "./codex-usage.ts";
import {
	reduceSessionEvent,
	type SessionEventStateSink,
	type SessionEventToolState,
} from "./session-event-reducer.ts";
import { classifySessionLeave, transitionRuntime } from "./session-transition.ts";

const bashPreviewLines = 8;
const bashCompactThreshold = 14;

type BackgroundSession = {
	runtime: AgentSessionRuntime;
	state: AppState;
	toolMessageIds: Map<string, string>;
	toolCallArgs: Map<string, unknown>;
	toolStartedAt: Map<string, number>;
	unsubscribe: () => void;
};

type ScopedModelCandidate = {
	id: string;
	provider: string;
	name?: string;
};

type PreparedSessionList =
	| { ok: true; sessions: SessionInfo[] }
	| { ok: false; error: unknown };

type AgentHostActivationOptions = {
	patchSessionMessages?: boolean;
	refreshWorkspaces?: boolean;
};

function resolveScopedModels<T extends ScopedModelCandidate>(
	patterns: string[],
	models: T[],
): Array<{ model: T; thinkingLevel?: AppThinkingLevel }> {
	const scoped: Array<{ model: T; thinkingLevel?: AppThinkingLevel }> = [];
	const seen = new Set<string>();
	for (const pattern of patterns) {
		const parsed = parseScopedModelPattern(pattern);
		if (!parsed.modelPattern) continue;
		const matches = models.filter((model) =>
			modelMatchesPattern(model, parsed.modelPattern),
		);
		for (const model of matches) {
			const key = `${model.provider}/${model.id}`;
			if (seen.has(key)) continue;
			seen.add(key);
			scoped.push({ model, thinkingLevel: parsed.thinkingLevel });
		}
	}
	return scoped;
}

function parseScopedModelPattern(pattern: string): {
	modelPattern: string;
	thinkingLevel?: AppThinkingLevel;
} {
	const trimmed = pattern.trim();
	const colonIndex = trimmed.lastIndexOf(":");
	if (colonIndex === -1) {
		return { modelPattern: trimmed };
	}
	const suffix = trimmed.slice(colonIndex + 1);
	if (!isThinkingLevel(suffix)) {
		return { modelPattern: trimmed };
	}
	return {
		modelPattern: trimmed.slice(0, colonIndex),
		thinkingLevel: suffix,
	};
}

function modelMatchesPattern(model: ScopedModelCandidate, pattern: string): boolean {
	const normalized = pattern.toLowerCase();
	const refs = [model.id, model.name ?? "", `${model.provider}/${model.id}`].map(
		(value) => value.toLowerCase(),
	);
	if (normalized.includes("*")) {
		const regex = wildcardPatternRegex(normalized);
		return refs.some((value) => regex.test(value));
	}
	return refs.some((value) => value === normalized || value.includes(normalized));
}

function wildcardPatternRegex(pattern: string): RegExp {
	const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, "\\$&");
	return new RegExp(`^${escaped.replaceAll("*", ".*")}$`, "i");
}

export class AgentHost {
	private unsubscribe: (() => void) | undefined;
	private readonly toolMessageIds = new Map<string, string>();
	private readonly toolCallArgs = new Map<string, unknown>();
	private readonly toolStartedAt = new Map<string, number>();
	private codexUsageText = "";
	private codexUsage: CodexUsage | undefined;
	private codexUsageFetchedAt = 0;
	private readonly codexUsageRequests = new CodexUsageRequestTracker();
	private codexUsageTimer: ReturnType<typeof setTimeout> | undefined;

	private readonly backgroundSessions = new Map<string, BackgroundSession>();

	private constructor(
		private runtime: AgentSessionRuntime,
		private readonly state: AppState,
		private readonly runtimeFactory: CreateAgentSessionRuntimeFactory,
		private readonly preparedSessions: PreparedSessionList,
		private readonly activationOptions: AgentHostActivationOptions,
	) {}

	static async create(
		state: AppState,
		cwd = defaultWorkspacePath(),
		options: AgentHostActivationOptions = {},
	): Promise<AgentHost> {
		const host = await AgentHost.prepare(state, cwd, options);
		host.activate();
		return host;
	}

	static async prepare(
		state: AppState,
		cwd = defaultWorkspacePath(),
		options: AgentHostActivationOptions = {},
	): Promise<AgentHost> {
		const sessionsPromise: Promise<PreparedSessionList> =
			SessionManager.listAll().then(
				(sessions) => ({ ok: true, sessions }),
				(error: unknown) => ({ ok: false, error }),
			);
		const createRuntime: CreateAgentSessionRuntimeFactory = async ({
			cwd,
			sessionManager,
			sessionStartEvent,
		}) => {
			const services = await createAgentSessionServices({ cwd });
			applyHttpProxySetting(services.settingsManager.getGlobalSettings().httpProxy);
			configureHttpDispatcher(services.settingsManager.getHttpIdleTimeoutMs());
			const scopedModels = resolveScopedModels(
				services.settingsManager.getEnabledModels() ?? [],
				services.modelRegistry
					.getAll()
					.filter((model) => services.modelRegistry.hasConfiguredAuth(model)),
			);
			return {
				...(await createAgentSessionFromServices({
					services,
					sessionManager,
					sessionStartEvent,
					scopedModels,
				})),
				services,
				diagnostics: services.diagnostics,
			};
		};

		const runtime = await createAgentSessionRuntime(createRuntime, {
			cwd,
			agentDir: getAgentDir(),
			sessionManager: SessionManager.create(cwd),
		});
		try {
			const host = new AgentHost(
				runtime,
				state,
				createRuntime,
				await sessionsPromise,
				options,
			);
			host.bindRuntimeCallbacks(runtime);
			await host.bindSessionExtensions();
			return host;
		} catch (error) {
			await runtime.dispose();
			throw error;
		}
	}

	activate(): void {
		this.bindSessionState({ refreshSessions: false });
		if (!this.preparedSessions.ok) {
			this.state.appendMessage(
				"system",
				`Failed to list sessions: ${formatError(this.preparedSessions.error)}`,
			);
			return;
		}
		const sessions = this.preparedSessions.sessions;
		if (this.activationOptions.refreshWorkspaces !== false) {
			this.state.setRecentWorkspaces(recentSessionWorkspaces(sessions));
		}
		this.state.setSessions(sessions.slice(0, 50).map(formatSessionSummary), {
			patchMessages: this.activationOptions.patchSessionMessages,
		});
	}

	async prompt(
		text: string,
		options: { streamingBehavior?: "steer" | "followUp" } = {},
	): Promise<boolean> {
		const trimmed = text.trim();
		if (!trimmed) {
			return false;
		}
		if (trimmed === "/tree") {
			this.loadTreeEntries();
			return true;
		}

		if (trimmed === "/compact" || trimmed.startsWith("/compact ")) {
			const customInstructions = trimmed.startsWith("/compact ")
				? trimmed.slice(9).trim()
				: undefined;
			void this.compact(customInstructions);
			return true;
		}

		let resolveAccepted: (accepted: boolean) => void = () => {};
		let settled = false;
		const accepted = new Promise<boolean>((resolve) => {
			resolveAccepted = (value) => {
				if (settled) {
					return;
				}
				settled = true;
				resolve(value);
			};
		});

		this.runtime.session
			.prompt(trimmed, {
				streamingBehavior: this.runtime.session.isStreaming
					? (options.streamingBehavior ?? "steer")
					: undefined,
				preflightResult: resolveAccepted,
			})
			.catch((error: unknown) => {
				resolveAccepted(false);
				this.state.appendMessage("system", formatError(error));
			});

		return await accepted;
	}

	async abort(): Promise<void> {
		await this.runtime.session.abort();
		this.state.setActivityText(undefined);
		this.state.setQueuedMessages([], []);
		this.loadCurrentSessionMessages();
		this.syncUsage();
	}

	restoreQueuedMessages(): string {
		const { steering, followUp } = this.runtime.session.clearQueue();
		this.state.setQueuedMessages([], []);
		return [...steering, ...followUp].join("\n\n");
	}

	async newSession(): Promise<boolean> {
		const session = this.runtime.session;
		const persisted = session.sessionManager.isPersisted();
		if (session.isStreaming || !persisted) {
			const cwd = session.sessionManager.getCwd();
			if (session.isStreaming && persisted) {
				this.backgroundCurrentRuntime();
			} else if (session.isStreaming) {
				await this.discardTemporaryRuntime();
			} else {
				this.unbindSession();
				this.runtime.dispose();
			}
			const runtime = await createAgentSessionRuntime(this.runtimeFactory, {
				cwd,
				agentDir: getAgentDir(),
				sessionManager: SessionManager.create(cwd),
				sessionStartEvent: { type: "session_start", reason: "new" },
			});
			this.runtime = runtime;
			this.bindRuntimeCallbacks(runtime);
		} else {
			const result = await this.runtime.newSession();
			if (result.cancelled) {
				return false;
			}
		}
		this.state.resetChat();
		await this.bindSession();
		return true;
	}

	async newTemporarySession(): Promise<boolean> {
		const previousSessionFile = this.runtime.session.sessionManager.getSessionFile();
		const cwd = this.runtime.session.sessionManager.getCwd();
		if (this.runtime.session.isStreaming) {
			if (this.runtime.session.sessionManager.isPersisted()) {
				this.backgroundCurrentRuntime();
			} else {
				await this.discardTemporaryRuntime();
			}
		} else {
			this.unbindSession();
			this.runtime.dispose();
		}

		const runtime = await createAgentSessionRuntime(this.runtimeFactory, {
			cwd,
			agentDir: getAgentDir(),
			sessionManager: SessionManager.inMemory(cwd),
			sessionStartEvent: {
				type: "session_start",
				reason: "new",
				previousSessionFile,
			},
		});
		this.runtime = runtime;
		this.bindRuntimeCallbacks(runtime);
		this.state.resetChat();
		await this.bindSession();
		return true;
	}

	async listSessions(): Promise<void> {
		await this.refreshSessions();
		this.syncUsage();
	}

	async deleteSession(sessionPath: string): Promise<boolean> {
		const targetSessionFile = SessionManager.open(sessionPath).getSessionFile();
		if (!targetSessionFile) {
			return false;
		}
		if (targetSessionFile === this.runtime.session.sessionManager.getSessionFile()) {
			this.state.appendMessage("system", "Cannot delete the current session.");
			return false;
		}
		if (this.backgroundSessions.has(targetSessionFile)) {
			this.state.appendMessage(
				"system",
				"Cannot delete a running background session.",
			);
			return false;
		}
		try {
			await moveToTrash(targetSessionFile);
			this.state.removeSession(targetSessionFile);
			return true;
		} catch (error) {
			this.state.appendMessage(
				"system",
				`Failed to delete session: ${formatError(error)}`,
			);
			return false;
		}
	}

	getWorkspacePath(): string {
		return this.runtime.session.sessionManager.getCwd();
	}

	async resumeSession(sessionPath: string): Promise<boolean> {
		if (!sessionPath.trim()) {
			return false;
		}
		const sessionManager = SessionManager.open(sessionPath);
		const targetSessionFile = sessionManager.getSessionFile();
		if (!targetSessionFile) {
			return false;
		}
		const backgroundSession = this.backgroundSessions.get(targetSessionFile);
		if (backgroundSession) {
			this.backgroundSessions.delete(targetSessionFile);
			await this.activateRuntime(backgroundSession);
			return true;
		}

		if (
			this.runtime.session.isStreaming ||
			!this.runtime.session.sessionManager.isPersisted()
		) {
			if (this.runtime.session.isStreaming) {
				const action = classifySessionLeave({
					persisted: this.runtime.session.sessionManager.isPersisted(),
					running: true,
					requiresNewRuntime: true,
				});
				if (action === "background") {
					this.backgroundCurrentRuntime();
				} else {
					await this.discardTemporaryRuntime();
				}
			} else {
				this.unbindSession();
				this.runtime.dispose();
			}
			this.runtime = await createAgentSessionRuntime(this.runtimeFactory, {
				cwd: sessionManager.getCwd(),
				agentDir: getAgentDir(),
				sessionManager,
			});
			this.bindRuntimeCallbacks(this.runtime);
			await this.bindSession();
			this.loadCurrentSessionMessages();
			return true;
		}

		const result = await this.runtime.switchSession(sessionPath);
		return !result.cancelled;
	}

	openTree(): boolean {
		this.loadTreeEntries();
		return true;
	}

	async navigateTree(
		entryId: string,
		options: { summarize?: boolean; customInstructions?: string } = {},
	): Promise<string | undefined> {
		if (!entryId.trim()) {
			return undefined;
		}
		const result = await this.runtime.session.navigateTree(entryId, {
			summarize: options.summarize ?? false,
			customInstructions: options.customInstructions,
		});
		if (result.cancelled) {
			return undefined;
		}
		this.loadCurrentSessionMessages();
		this.loadTreeEntries();
		return result.editorText;
	}

	async setThinkingLevel(level: string): Promise<boolean> {
		if (!isThinkingLevel(level)) {
			return false;
		}
		this.runtime.session.setThinkingLevel(level);
		this.syncThinking();
		return true;
	}

	cycleThinkingLevel(direction: "forward" | "backward" = "forward"): boolean {
		if (direction === "forward") {
			const level = this.runtime.session.cycleThinkingLevel();
			if (!level) {
				return false;
			}
			this.syncThinking();
			return true;
		}

		if (!this.runtime.session.supportsThinking()) {
			return false;
		}

		const levels =
			this.runtime.session.getAvailableThinkingLevels() as AppThinkingLevel[];
		if (levels.length === 0) {
			return false;
		}
		const currentIndex = levels.indexOf(
			this.runtime.session.thinkingLevel as AppThinkingLevel,
		);
		const previousIndex = currentIndex <= 0 ? levels.length - 1 : currentIndex - 1;
		this.runtime.session.setThinkingLevel(levels[previousIndex]);
		this.syncThinking();
		return true;
	}

	async compact(customInstructions?: string): Promise<boolean> {
		try {
			await this.runtime.session.compact(customInstructions);
			this.loadCurrentSessionMessages();
			return true;
		} catch (error) {
			this.state.appendMessage("system", formatError(error));
			return false;
		}
	}

	async setModel(modelRef: string): Promise<boolean> {
		const model = this.findModelRef(modelRef);
		if (!model) {
			this.state.appendMessage("system", `Model not found: ${modelRef}`);
			return false;
		}
		await this.runtime.session.setModel(model);
		this.afterModelChange();
		return true;
	}

	async cycleModel(direction: "forward" | "backward" = "forward"): Promise<boolean> {
		const result = await this.runtime.session.cycleModel(direction);
		if (!result) {
			return false;
		}
		this.afterModelChange();
		return true;
	}

	async toggleScopedModel(modelRef: string): Promise<boolean> {
		const model = this.findModelRef(modelRef);
		if (!model) {
			this.state.appendMessage("system", `Model not found: ${modelRef}`);
			return false;
		}
		const session = this.runtime.session;
		const modelKey = `${model.provider}/${model.id}`;
		const scoped = session.scopedModels.filter(
			(item) => `${item.model.provider}/${item.model.id}` !== modelKey,
		);
		if (scoped.length === session.scopedModels.length) {
			scoped.push({ model });
		}

		const configuredCount = session.modelRegistry
			.getAll()
			.filter((item) => session.modelRegistry.hasConfiguredAuth(item)).length;
		const enabledModels =
			scoped.length === 0 || scoped.length === configuredCount
				? undefined
				: scoped.map((item) => `${item.model.provider}/${item.model.id}`);
		this.runtime.services.settingsManager.setEnabledModels(enabledModels);
		await this.runtime.services.settingsManager.flush();

		session.setScopedModels(enabledModels === undefined ? [] : scoped);
		this.syncModels({ reopenPicker: true });
		return true;
	}

	dispose(): void {
		this.unsubscribe?.();
		this.invalidateCodexUsageRequest();
		this.runtime.dispose();
		for (const { runtime, unsubscribe } of this.backgroundSessions.values()) {
			unsubscribe();
			runtime.dispose();
		}
		this.backgroundSessions.clear();
	}

	private bindRuntimeCallbacks(runtime: AgentSessionRuntime): void {
		runtime.setBeforeSessionInvalidate(() => this.unbindSession());
		runtime.setRebindSession(async () => {
			await this.bindSessionExtensions();
			this.bindSessionState();
			this.loadCurrentSessionMessages();
		});
	}

	private async discardTemporaryRuntime(): Promise<void> {
		const runtime = this.runtime;
		await transitionRuntime({
			action: "discard",
			unsubscribe: () => this.unbindSession(),
			abort: () => runtime.session.abort(),
			dispose: () => runtime.dispose(),
			background: () => {},
			bindReplacement: () => {},
			onAbortError: (error) => {
				this.state.appendMessage(
					"system",
					`Failed to abort temporary session: ${formatError(error)}`,
				);
			},
		});
		this.state.setActivityText(undefined);
		this.state.setQueuedMessages([], []);
		this.toolMessageIds.clear();
		this.toolCallArgs.clear();
		this.toolStartedAt.clear();
	}

	private backgroundCurrentRuntime(): void {
		this.unbindSession();
		this.state.setQueuedMessages([], []);
		const sessionFile = this.runtime.session.sessionManager.getSessionFile();
		if (sessionFile) {
			const backgroundState = new AppState();
			backgroundState.restoreChat(this.state.snapshotChat());
			backgroundState.setWorkspacePath(
				this.runtime.session.sessionManager.getCwd(),
			);
			backgroundState.setCurrentSessionPath(sessionFile);
			backgroundState.setTemporarySession(false);
			const backgroundSession: BackgroundSession = {
				runtime: this.runtime,
				state: backgroundState,
				toolMessageIds: new Map(this.toolMessageIds),
				toolCallArgs: new Map(this.toolCallArgs),
				toolStartedAt: new Map(this.toolStartedAt),
				unsubscribe: () => {},
			};
			backgroundSession.unsubscribe = this.runtime.session.subscribe((event) =>
				this.handleBackgroundEvent(sessionFile, backgroundSession, event),
			);
			this.backgroundSessions.set(sessionFile, backgroundSession);
		}
	}

	private handleBackgroundEvent(
		sessionFile: string,
		backgroundSession: BackgroundSession,
		event: AgentSessionEvent,
	): void {
		const outcome = this.reduceEvent(
			event,
			backgroundSession.state,
			{
				messageIds: backgroundSession.toolMessageIds,
				callArgs: backgroundSession.toolCallArgs,
				startedAt: backgroundSession.toolStartedAt,
			},
			() =>
				this.loadRuntimeMessages(
					backgroundSession.runtime,
					backgroundSession.state,
				),
		);
		if (outcome.agentCompleted) {
			backgroundSession.unsubscribe();
			this.notifyBackgroundSessionDone(backgroundSession.runtime);
			void this.refreshSessions();
		}
		this.backgroundSessions.set(sessionFile, backgroundSession);
	}

	private async notifyBackgroundSessionDone(
		runtime: AgentSessionRuntime,
	): Promise<void> {
		if (typeof Notification !== "function") return;
		try {
			if (Notification.permission !== "granted") {
				const permission = await Notification.requestPermission();
				if (permission !== "granted") return;
			}
			const workspace = formatHomePath(runtime.session.sessionManager.getCwd());
			new Notification(`pi finished: ${workspace}`, {
				body: "Background session completed.",
				tag: runtime.session.sessionManager.getSessionFile() ?? workspace,
			});
		} catch {
			// Notifications are best-effort.
		}
	}

	private async activateRuntime(backgroundSession: BackgroundSession): Promise<void> {
		if (this.runtime.session.isStreaming) {
			if (this.runtime.session.sessionManager.isPersisted()) {
				this.backgroundCurrentRuntime();
			} else {
				await this.discardTemporaryRuntime();
			}
		} else {
			this.unbindSession();
			this.runtime.dispose();
		}
		backgroundSession.unsubscribe();
		this.runtime = backgroundSession.runtime;
		this.toolMessageIds.clear();
		this.toolCallArgs.clear();
		this.toolStartedAt.clear();
		for (const [key, value] of backgroundSession.toolMessageIds) {
			this.toolMessageIds.set(key, value);
		}
		for (const [key, value] of backgroundSession.toolCallArgs) {
			this.toolCallArgs.set(key, value);
		}
		for (const [key, value] of backgroundSession.toolStartedAt) {
			this.toolStartedAt.set(key, value);
		}
		this.bindRuntimeCallbacks(this.runtime);
		this.bindSessionState({ resetToolState: false });
		if (this.runtime.session.isStreaming) {
			this.state.restoreChat(backgroundSession.state.snapshotChat());
		} else {
			this.loadCurrentSessionMessages();
		}
	}

	private async bindSession(
		options: { refreshSessions?: boolean } = {},
	): Promise<void> {
		this.unbindSession();
		await this.bindSessionExtensions();
		this.bindSessionState(options);
	}

	private unbindSession(): void {
		this.unsubscribe?.();
		this.unsubscribe = undefined;
		this.resetCodexUsage();
	}

	private bindSessionState(
		options: { resetToolState?: boolean; refreshSessions?: boolean } = {},
	): void {
		const session = this.runtime.session;
		const resetToolState = options.resetToolState ?? true;
		this.state.setWorkspacePath(session.sessionManager.getCwd());
		this.state.setCurrentSessionPath(session.sessionManager.getSessionFile());
		this.state.setTemporarySession(!session.sessionManager.isPersisted());
		if (resetToolState) {
			this.toolMessageIds.clear();
			this.toolCallArgs.clear();
			this.toolStartedAt.clear();
		}
		this.unsubscribe = session.subscribe((event) => this.handleEvent(event));
		this.state.setActivityText(session.isStreaming ? "Working..." : undefined);
		this.syncModels();
		this.syncThinking();
		this.syncSlashCommands();
		this.syncUsage();
		this.refreshCodexUsage(true);
		if (options.refreshSessions !== false) {
			void this.refreshSessions();
		}
	}

	private async bindSessionExtensions(): Promise<void> {
		await this.runtime.session.bindExtensions({ mode: "rpc" });
	}

	private async refreshSessions(): Promise<void> {
		try {
			const sessions = await SessionManager.listAll();
			this.state.setRecentWorkspaces(recentSessionWorkspaces(sessions));
			this.state.setSessions(sessions.slice(0, 50).map(formatSessionSummary));
		} catch (error) {
			this.state.appendMessage(
				"system",
				`Failed to list sessions: ${formatError(error)}`,
			);
		}
	}

	private findModelRef(modelRef: string) {
		const [provider, ...idParts] = modelRef.split("/");
		const modelId = idParts.join("/");
		if (!provider || !modelId) {
			return undefined;
		}
		return this.runtime.session.modelRegistry.find(provider, modelId);
	}

	private afterModelChange(): void {
		this.resetCodexUsage();
		this.syncModels();
		this.syncThinking();
		this.syncUsage();
		this.refreshCodexUsage(true);
	}

	private syncModels(options: { reopenPicker?: boolean } = {}): void {
		const session = this.runtime.session;
		const currentModel = session.model
			? `${session.model.provider}/${session.model.id}`
			: undefined;
		const scopedModelRefs = new Set(
			session.scopedModels.map(
				(scoped) => `${scoped.model.provider}/${scoped.model.id}`,
			),
		);
		const models = session.modelRegistry
			.getAll()
			.map((model) => ({
				id: model.id,
				provider: model.provider,
				name: model.name ?? model.id,
				configured: session.modelRegistry.hasConfiguredAuth(model),
				scoped: scopedModelRefs.has(`${model.provider}/${model.id}`),
			}))
			.filter(
				(model) =>
					model.configured || `${model.provider}/${model.id}` === currentModel,
			)
			.sort((a, b) => {
				const aIsCurrent = `${a.provider}/${a.id}` === currentModel;
				const bIsCurrent = `${b.provider}/${b.id}` === currentModel;
				if (aIsCurrent && !bIsCurrent) return -1;
				if (!aIsCurrent && bIsCurrent) return 1;
				return a.provider.localeCompare(b.provider);
			});
		this.state.setModels(models, currentModel, options);
	}

	private handleEvent(event: AgentSessionEvent): void {
		const outcome = this.reduceEvent(
			event,
			this.state,
			{
				messageIds: this.toolMessageIds,
				callArgs: this.toolCallArgs,
				startedAt: this.toolStartedAt,
			},
			() => this.loadCurrentSessionMessages(),
			() => this.syncUsage(),
		);
		if (outcome.agentCompleted) {
			this.syncUsage();
			this.refreshCodexUsage(true);
		}
	}

	private reduceEvent(
		event: AgentSessionEvent,
		state: SessionEventStateSink,
		tools: SessionEventToolState,
		reloadMessages: () => void,
		syncUsage?: () => void,
	) {
		return reduceSessionEvent(event, {
			state,
			tools,
			convertMessage: (message, timestamp) =>
				this.agentMessageToAppMessages(message, timestamp),
			formatToolStart: (toolEvent) => {
				const view = formatToolStart(toolEvent.toolName, toolEvent.args);
				return {
					text: view.text,
					options: {
						title: toolTitle("running", toolEvent.toolName, toolEvent.args),
						titleParts: toolTitleParts(toolEvent.toolName, toolEvent.args),
						meta:
							toolMeta(toolEvent.toolName, toolEvent.args) ?? "Running...",
						state: "running",
						format: view.format,
					},
				};
			},
			formatToolUpdate: (toolEvent) => {
				const view = formatToolResult(
					toolEvent.toolName,
					toolEvent.partialResult,
					{ args: toolEvent.args },
				);
				return {
					text: view.text,
					meta: toolMeta(toolEvent.toolName, toolEvent.args),
					format: view.format,
				};
			},
			formatToolEnd: (toolEvent, args, startedAt) => {
				const view = formatToolResult(toolEvent.toolName, toolEvent.result, {
					args,
					isError: toolEvent.isError,
				});
				return {
					text: view.text,
					options: {
						title: toolTitle(
							toolEvent.isError ? "error" : "success",
							toolEvent.toolName,
							args,
						),
						meta: toolEndMeta(startedAt),
						state: toolEvent.isError ? "error" : "success",
						titleParts: toolTitleParts(toolEvent.toolName, args),
						format: view.format,
					},
				};
			},
			syncUsage,
			reloadMessages,
		});
	}

	private syncThinking(): void {
		const session = this.runtime.session;
		this.state.setThinking(
			session.thinkingLevel as AppThinkingLevel,
			session.getAvailableThinkingLevels() as AppThinkingLevel[],
		);
	}

	private syncUsage(): void {
		this.state.setUsage(
			formatStats(
				this.runtime.session.getSessionStats(),
				this.codexUsageText,
				this.codexUsage,
			),
		);
	}

	private clearCodexUsageTimer(): void {
		if (!this.codexUsageTimer) return;
		clearTimeout(this.codexUsageTimer);
		this.codexUsageTimer = undefined;
	}

	private invalidateCodexUsageRequest(): void {
		this.codexUsageRequests.invalidate();
		this.clearCodexUsageTimer();
	}

	private resetCodexUsage(): void {
		this.invalidateCodexUsageRequest();
		this.codexUsageText = "";
		this.codexUsage = undefined;
		this.codexUsageFetchedAt = 0;
	}

	private scheduleCodexUsageRefresh(): void {
		this.clearCodexUsageTimer();
		this.codexUsageTimer = setTimeout(() => {
			this.codexUsageTimer = undefined;
			this.refreshCodexUsage(true);
		}, codexUsageTtlMs);
		this.codexUsageTimer.unref?.();
	}

	private refreshCodexUsage(force = false): void {
		const runtime = this.runtime;
		const session = runtime.session;
		if (!isOpenAICodex(session.model)) {
			this.resetCodexUsage();
			this.syncUsage();
			return;
		}
		if (this.codexUsageRequests.loading) return;
		if (!force && Date.now() - this.codexUsageFetchedAt < codexUsageTtlMs) {
			return;
		}

		const request = this.codexUsageRequests.begin(runtime, session, session.model);
		if (!this.codexUsageText) {
			this.codexUsageText = "loading";
			this.syncUsage();
		}
		void fetchCodexUsage(session)
			.then((usage) => {
				if (
					!this.codexUsageRequests.owns(
						request,
						this.runtime,
						this.runtime.session,
						this.runtime.session.model,
					)
				)
					return;
				this.codexUsageText = usage ? formatCodexUsage(usage) : "unavailable";
				this.codexUsage = usage;
				this.codexUsageFetchedAt = Date.now();
				this.syncUsage();
			})
			.catch((error: unknown) => {
				if (
					!this.codexUsageRequests.owns(
						request,
						this.runtime,
						this.runtime.session,
						this.runtime.session.model,
					)
				)
					return;
				console.warn("Failed to fetch Codex usage", error);
				this.codexUsageText = "unavailable";
				this.codexUsage = undefined;
				this.codexUsageFetchedAt = Date.now();
				this.syncUsage();
			})
			.finally(() => {
				if (
					!this.codexUsageRequests.release(
						request,
						this.runtime,
						this.runtime.session,
						this.runtime.session.model,
					)
				)
					return;
				this.scheduleCodexUsageRefresh();
			});
	}

	private syncSlashCommands(): void {
		const prompts = this.runtime.session.promptTemplates.map((template) => ({
			name: template.name,
			description: template.description,
			argumentHint: template.argumentHint,
			source: "prompt" as const,
		}));
		const skills = this.runtime.session.resourceLoader
			.getSkills()
			.skills.map((skill) => ({
				name: `skill:${skill.name}`,
				description: skill.description,
				source: "skill" as const,
			}));
		this.state.setSlashCommands([
			{
				name: "tree",
				description: "Navigate and branch within the current session",
				source: "system" as const,
			},
			{
				name: "compact",
				description: "Manually compact the session context",
				source: "system" as const,
				argumentHint: "[instructions]",
			},
			...prompts,
			...skills,
		]);
	}

	private loadTreeEntries(): void {
		const sessionManager = this.runtime.session.sessionManager;
		const activeId = sessionManager.getLeafId();
		const pathIds = new Set(sessionManager.getBranch().map((entry) => entry.id));
		this.state.setTreeEntries(
			flattenTree(sessionManager.getTree(), activeId, pathIds),
		);
	}

	private loadCurrentSessionMessages(): void {
		this.loadRuntimeMessages(this.runtime, this.state);
		this.syncUsage();
	}

	private loadRuntimeMessages(runtime: AgentSessionRuntime, state: AppState): void {
		const branch = runtime.session.sessionManager.getBranch();
		const pendingToolCalls = new Map<string, { name: string; args: unknown }>();
		const messages = branch.flatMap((entry: SessionEntry) =>
			this.entryToMessages(entry, pendingToolCalls),
		);
		state.replaceMessages(messages);
	}

	private entryToMessages(
		entry: SessionEntry,
		pendingToolCalls: Map<string, { name: string; args: unknown }>,
	): AppMessageInput[] {
		const timestamp = new Date(entry.timestamp);
		if (entry.type === "message") {
			if (entry.message.role === "assistant") {
				for (const toolCall of extractToolCalls(entry.message.content)) {
					pendingToolCalls.set(toolCall.id, {
						name: toolCall.name,
						args: toolCall.arguments,
					});
				}
			}
			if (entry.message.role === "toolResult") {
				const toolCall = pendingToolCalls.get(entry.message.toolCallId);
				pendingToolCalls.delete(entry.message.toolCallId);
				return [toolResultToAppMessage(entry.message, timestamp, toolCall)];
			}
			return this.agentMessageToAppMessages(entry.message, timestamp);
		}
		if (entry.type === "custom_message" && entry.display) {
			return [
				{
					role: "system",
					text: contentToText(entry.content),
					timestamp,
				},
			];
		}
		if (entry.type === "compaction") {
			return [
				{
					role: "compaction",
					text: entry.summary,
					timestamp,
					title: "[compaction]",
					meta: `Compacted from ${entry.tokensBefore.toLocaleString()} tokens`,
				},
			];
		}
		if (entry.type === "branch_summary") {
			return [{ role: "system", text: entry.summary, timestamp }];
		}
		if (entry.type === "model_change" || entry.type === "thinking_level_change") {
			return [];
		}
		return [];
	}

	private agentMessageToAppMessage(
		message: Extract<AgentSessionEvent, { type: "message_start" }>["message"],
		timestamp: Date,
	): AppMessageInput | undefined {
		return this.agentMessageToAppMessages(message, timestamp)[0];
	}

	private agentMessageToAppMessages(
		message: Extract<AgentSessionEvent, { type: "message_start" }>["message"],
		timestamp: Date,
	): AppMessageInput[] {
		switch (message.role) {
			case "user":
				return userContentToMessages(contentToText(message.content), timestamp);
			case "assistant":
				return assistantContentToMessages(message.content, timestamp);
			case "toolResult":
				return [toolResultToAppMessage(message, timestamp)];
			case "bashExecution":
				return [
					{
						role: "tool",
						text: compactToolOutput(message.output),
						timestamp,
						title: `$ ${message.command}`,
						titleParts: [{ text: `$ ${message.command}` }],
						meta:
							message.exitCode === undefined
								? "cancelled"
								: `exit ${message.exitCode}`,
						state: message.exitCode === 0 ? "success" : "error",
						format: "code",
					},
				];
			case "custom":
				if (message.display) {
					return [
						{
							role: "system",
							text: contentToText(message.content),
							timestamp,
						},
					];
				}
				return [];
			case "branchSummary":
				return [{ role: "system", text: message.summary, timestamp }];
			case "compactionSummary":
				return [
					{
						role: "compaction",
						text: message.summary,
						timestamp,
						title: "[compaction]",
						meta: `Compacted from ${message.tokensBefore.toLocaleString()} tokens`,
					},
				];
		}
	}
}

function isThinkingLevel(level: string): level is AppThinkingLevel {
	return ["off", "minimal", "low", "medium", "high", "xhigh"].includes(level);
}

function userContentToMessages(text: string, timestamp: Date): AppMessageInput[] {
	const skillBlock = parseSkillBlock(text);
	if (!skillBlock) {
		return [{ role: "user", text, timestamp }];
	}

	const messages: AppMessageInput[] = [
		{
			role: "skill",
			text: skillBlock.content,
			timestamp,
			title: "[skill]",
			meta: skillBlock.name,
		},
	];
	if (skillBlock.userMessage) {
		messages.push({ role: "user", text: skillBlock.userMessage, timestamp });
	}
	return messages;
}

function toolResultToAppMessage(
	message: Extract<AgentSessionEvent, { type: "message_start" }>["message"] & {
		role: "toolResult";
	},
	timestamp: Date,
	toolCall?: { name: string; args: unknown },
): AppMessageInput {
	const resultView = formatToolResult(message.toolName, message, {
		args: toolCall?.args,
		isError: message.isError,
	});
	return {
		role: "tool",
		text: resultView.text,
		timestamp,
		title: toolCall
			? toolTitle(
					message.isError ? "error" : "success",
					toolCall.name,
					toolCall.args,
				)
			: message.toolName,
		titleParts: toolCall ? toolTitleParts(toolCall.name, toolCall.args) : undefined,
		meta: undefined,
		state: message.isError ? "error" : "success",
		format: resultView.format,
	};
}

function extractToolCalls(content: unknown): Array<{
	id: string;
	name: string;
	arguments: unknown;
}> {
	if (!Array.isArray(content)) {
		return [];
	}
	return content.flatMap((part) => {
		if (
			isRecord(part) &&
			part.type === "toolCall" &&
			typeof part.id === "string" &&
			typeof part.name === "string"
		) {
			return [{ id: part.id, name: part.name, arguments: part.arguments }];
		}
		return [];
	});
}

function assistantContentToMessages(
	content: Extract<
		AgentSessionEvent,
		{ type: "message_start" }
	>["message"] extends infer M
		? M extends { role: "assistant"; content: infer C }
			? C
			: never
		: never,
	timestamp: Date,
): AppMessageInput[] {
	if (!Array.isArray(content)) {
		return [{ role: "assistant", text: contentToText(content), timestamp }];
	}

	const messages: AppMessageInput[] = [];
	let assistantText = "";
	let thoughtText = "";
	for (const part of content) {
		if (
			isRecord(part) &&
			part.type === "thinking" &&
			typeof part.thinking === "string"
		) {
			thoughtText += `${thoughtText ? "\n\n" : ""}${part.thinking}`;
			continue;
		}
		if (isRecord(part) && part.type === "text" && typeof part.text === "string") {
			assistantText += part.text;
		}
	}
	if (thoughtText.trim()) {
		messages.push({ role: "thought", text: thoughtText, timestamp });
	}
	if (assistantText.trim()) {
		messages.push({ role: "assistant", text: stripAnsi(assistantText), timestamp });
	}
	return messages;
}

function flattenTree(
	roots: SessionTreeNode[],
	activeId: string | null,
	pathIds: Set<string>,
): AppTreeEntry[] {
	const rows: AppTreeEntry[] = [];
	const containsActive = new Map<SessionTreeNode, boolean>();
	const visitPostOrder = (node: SessionTreeNode): boolean => {
		const contains = node.entry.id === activeId || node.children.some(visitPostOrder);
		containsActive.set(node, contains);
		return contains;
	};
	roots.forEach(visitPostOrder);

	type StackItem = {
		node: SessionTreeNode;
		indent: number;
		justBranched: boolean;
		showConnector: boolean;
		isLast: boolean;
		gutters: boolean[];
	};
	const multipleRoots = roots.length > 1;
	const orderedRoots = orderActiveFirst(roots, containsActive);
	const stack: StackItem[] = orderedRoots.toReversed().map((node, index) => ({
		node,
		indent: multipleRoots ? 1 : 0,
		justBranched: multipleRoots,
		showConnector: multipleRoots,
		isLast: index === 0,
		gutters: [],
	}));

	while (stack.length > 0) {
		const { node, indent, justBranched, showConnector, isLast, gutters } =
			stack.pop()!;
		rows.push({
			id: node.entry.id,
			parentId: node.entry.parentId,
			prefix: buildTreePrefix(indent, showConnector, isLast, gutters),
			continuationPrefix: buildTreeContinuationPrefix(
				indent,
				showConnector,
				isLast,
				gutters,
			),
			label: node.label,
			active: node.entry.id === activeId,
			inPath: pathIds.has(node.entry.id),
			...formatTreeEntry(node),
		});

		const children = orderActiveFirst(node.children, containsActive);
		const multipleChildren = children.length > 1;
		const childIndent = multipleChildren
			? indent + 1
			: justBranched && indent > 0
				? indent + 1
				: indent;
		const childGutters = [...gutters];
		if (showConnector && indent > 0) {
			childGutters[indent - 1] = !isLast;
		}
		for (let index = children.length - 1; index >= 0; index -= 1) {
			stack.push({
				node: children[index],
				indent: childIndent,
				justBranched: multipleChildren,
				showConnector: multipleChildren,
				isLast: index === children.length - 1,
				gutters: childGutters,
			});
		}
	}
	return rows;
}

function orderActiveFirst(
	nodes: SessionTreeNode[],
	containsActive: Map<SessionTreeNode, boolean>,
): SessionTreeNode[] {
	return [...nodes].sort(
		(a, b) => Number(containsActive.get(b)) - Number(containsActive.get(a)),
	);
}

function buildTreePrefix(
	indent: number,
	showConnector: boolean,
	isLast: boolean,
	gutters: boolean[],
): string {
	if (indent === 0 && !showConnector) return "";
	const parts: string[] = [];
	for (let position = 0; position < indent; position += 1) {
		if (position === indent - 1 && showConnector) {
			parts.push(isLast ? "└─ " : "├─ ");
		} else {
			parts.push(gutters[position] ? "│  " : "   ");
		}
	}
	return parts.join("");
}

function buildTreeContinuationPrefix(
	indent: number,
	showConnector: boolean,
	isLast: boolean,
	gutters: boolean[],
): string {
	if (indent === 0 && !showConnector) return "";
	const parts: string[] = [];
	for (let position = 0; position < indent; position += 1) {
		if (position === indent - 1 && showConnector) {
			parts.push(isLast ? "   " : "│  ");
		} else {
			parts.push(gutters[position] ? "│  " : "   ");
		}
	}
	return parts.join("");
}

function formatTreeEntry(
	node: SessionTreeNode,
): Pick<AppTreeEntry, "role" | "text" | "meta"> {
	const entry = node.entry;
	const meta = formatDateTime(new Date(entry.timestamp));
	if (entry.type === "message") {
		const message = entry.message;
		if (message.role === "user") {
			return {
				role: "user: ",
				text: normalizeTreeText(extractTreeText(message.content)),
				meta,
			};
		}
		if (message.role === "assistant") {
			const text = normalizeTreeText(extractTreeText(message.content));
			return { role: "assistant: ", text: text || "(no text)", meta };
		}
		if (message.role === "toolResult") {
			return { role: "tool: ", text: message.toolName ?? "tool", meta };
		}
		if (message.role === "bashExecution") {
			return { role: "bash: ", text: normalizeTreeText(message.command), meta };
		}
		return { role: `${message.role}: `, text: "", meta };
	}
	if (entry.type === "custom_message") {
		return {
			role: `${entry.customType}: `,
			text: normalizeTreeText(extractTreeText(entry.content)),
			meta,
		};
	}
	if (entry.type === "compaction") {
		return {
			role: "compaction: ",
			text: `${Math.round(entry.tokensBefore / 1000)}k tokens`,
			meta,
		};
	}
	if (entry.type === "branch_summary") {
		return { role: "branch summary: ", text: normalizeTreeText(entry.summary), meta };
	}
	if (entry.type === "model_change") {
		return { role: "model: ", text: entry.modelId, meta };
	}
	if (entry.type === "thinking_level_change") {
		return { role: "thinking: ", text: entry.thinkingLevel, meta };
	}
	if (entry.type === "custom") {
		return { role: "custom: ", text: entry.customType, meta };
	}
	if (entry.type === "label") {
		return { role: "label: ", text: entry.label ?? "(cleared)", meta };
	}
	return { role: "title: ", text: entry.name ?? "(empty)", meta };
}

function extractTreeText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	return content
		.filter(
			(item): item is { type: "text"; text: string } =>
				isRecord(item) && item.type === "text" && typeof item.text === "string",
		)
		.map((item) => item.text)
		.join(" ");
}

function normalizeTreeText(text: string): string {
	return text
		.replace(/[\n\t]+/g, " ")
		.replace(/\s+/g, " ")
		.trim()
		.slice(0, 240);
}

async function moveToTrash(path: string): Promise<void> {
	const command = trashCommand(path);
	try {
		const output = await new Deno.Command(command.command, {
			args: command.args,
		}).output();
		if (!output.success) {
			const stderr = new TextDecoder().decode(output.stderr).trim();
			throw new Error(stderr || `Trash command failed with code ${output.code}`);
		}
	} catch (error) {
		if (error instanceof Deno.errors.NotFound) {
			await Deno.remove(path);
			return;
		}
		throw error;
	}
}

function trashCommand(path: string): { command: string; args: string[] } {
	if (Deno.build.os === "darwin") {
		return {
			command: "osascript",
			args: [
				"-e",
				`tell application "Finder" to delete POSIX file ${JSON.stringify(path)}`,
			],
		};
	}
	if (Deno.build.os === "windows") {
		return {
			command: "powershell",
			args: [
				"-NoProfile",
				"-Command",
				`Add-Type -AssemblyName Microsoft.VisualBasic; [Microsoft.VisualBasic.FileIO.FileSystem]::DeleteFile(${JSON.stringify(path)}, 'OnlyErrorDialogs', 'SendToRecycleBin')`,
			],
		};
	}
	return { command: "trash", args: [path] };
}

function recentSessionWorkspaces(sessions: SessionInfo[]): string[] {
	const workspaces: string[] = [];
	for (const session of sessions) {
		if (!session.cwd || workspaces.includes(session.cwd)) {
			continue;
		}
		workspaces.push(session.cwd);
		if (workspaces.length >= 8) {
			break;
		}
	}
	return workspaces;
}

function formatSessionSummary(info: SessionInfo): AppSessionSummary {
	const title = info.name?.trim() || info.firstMessage.trim() || "Untitled session";
	const messageLabel = `${info.messageCount} message${info.messageCount === 1 ? "" : "s"}`;
	return {
		path: info.path,
		cwd: info.cwd,
		title: truncate(title, 96),
		subtitle: `${messageLabel} • ${truncate(info.cwd, 64)}`,
		modified: formatDateTime(info.modified),
	};
}

function formatStats(
	stats: SessionStats,
	codexUsageText = "",
	codexUsage?: CodexUsage,
): AppUsage {
	const cost = formatCost(stats.cost);
	if (stats.contextUsage) {
		const context = `${formatPercent(stats.contextUsage.percent)}/${formatTokens(
			stats.contextUsage.contextWindow,
		)}`;
		return {
			text: `${cost} • ${context}`,
			contextPercent: stats.contextUsage.percent ?? undefined,
			codexText: codexUsageText || undefined,
			codexPrimaryPercent: codexUsage?.primary?.usedPercent,
			codexSecondaryPercent: codexUsage?.secondary?.usedPercent,
		};
	}
	return {
		text: `${cost} • ${formatTokens(stats.tokens.total)} tokens`,
		codexText: codexUsageText || undefined,
		codexPrimaryPercent: codexUsage?.primary?.usedPercent,
		codexSecondaryPercent: codexUsage?.secondary?.usedPercent,
	};
}

function formatTokens(count: number): string {
	if (count < 1_000) return count.toString();
	if (count < 10_000) return `${(count / 1_000).toFixed(1)}k`;
	if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
	if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
	return `${Math.round(count / 1_000_000)}M`;
}

function formatCost(cost: number): string {
	if (cost < 1) return `$${cost.toFixed(3)}`;
	if (cost < 100) return `$${cost.toFixed(1)}`;
	return `$${Math.round(cost)}`;
}

function formatPercent(value: number | null): string {
	return typeof value === "number" ? `${value.toFixed(1)}%` : "?";
}

function truncate(value: string, maxLength: number): string {
	return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function toolTitleParts(toolName: string, args: unknown): AppMessageTitlePart[] {
	const record = asRecord(args);
	if (toolName === "bash" && record) {
		const timeout =
			typeof record.timeout === "number" ? ` timeout ${record.timeout}s` : "";
		return [
			{ text: "$ ", tone: "accent", mono: true },
			{ text: stringValue(record.command) || "...", mono: true, highlight: "bash" },
			...(timeout ? [{ text: timeout, tone: "muted", mono: true } as const] : []),
		];
	}

	const target = toolTarget(toolName, args);
	return [
		{ text: `${toolName}${target ? " " : ""}` },
		...(target ? [{ text: target, tone: "accent", mono: true } as const] : []),
		...(toolRange(args)
			? [{ text: toolRange(args), tone: "warning", mono: true } as const]
			: []),
	];
}

function toolTitle(
	status: "running" | "success" | "error",
	toolName: string,
	args: unknown,
): string {
	const record = asRecord(args);
	if (toolName === "bash" && record) {
		const timeout =
			typeof record.timeout === "number" ? ` timeout ${record.timeout}s` : "";
		return `$ ${stringValue(record.command) || "..."}${timeout}`;
	}

	const verb = toolName;
	const target = toolTarget(toolName, args);
	return target ? `${verb} ${target}${toolRange(args)}` : verb;
}

function toolMeta(toolName: string, args: unknown): string | undefined {
	const record = asRecord(args);
	if (!record) return undefined;
	const details: string[] = [];
	if (toolName === "edit" && Array.isArray(record.edits)) {
		details.push(
			`${record.edits.length} edit${record.edits.length === 1 ? "" : "s"}`,
		);
	}
	if (typeof record.limit === "number") {
		details.push(`limit ${record.limit}`);
	}
	return details.join(" • ") || undefined;
}

function toolEndMeta(startedAt: number | undefined): string | undefined {
	if (startedAt === undefined) return undefined;
	const duration = formatDuration(Date.now() - startedAt);
	return duration === "0.0s" ? undefined : duration;
}

function formatDuration(ms: number): string {
	return `${(ms / 1000).toFixed(1)}s`;
}

function toolRange(args: unknown): string {
	const record = asRecord(args);
	if (!record || typeof record.offset !== "number") return "";
	if (typeof record.limit !== "number") return `:${record.offset}`;
	return `:${record.offset}-${record.offset + record.limit - 1}`;
}

function toolTarget(toolName: string, args: unknown): string {
	const record = asRecord(args);
	if (!record) return "";
	if (toolName === "bash") return stringValue(record.command);
	if (toolName === "grep") {
		const pattern = stringValue(record.pattern);
		const path = stringValue(record.path);
		return path ? `${pattern} in ${path}` : pattern;
	}
	if (toolName === "find") {
		const pattern = stringValue(record.pattern);
		const path = stringValue(record.path);
		return path ? `${pattern} in ${path}` : pattern;
	}
	return shortenPath(stringValue(record.path) || stringValue(record.file_path));
}

function formatToolStart(
	toolName: string,
	args: unknown,
): { text: string; format?: "pre" | "diff" | "code" } {
	const record = asRecord(args);
	if (!record) return { text: summarizeValue(args), format: "pre" };
	if (toolName === "bash") return { text: "", format: "pre" };
	if (toolName === "edit") {
		const count = Array.isArray(record.edits) ? record.edits.length : 0;
		return {
			text: `${count} replacement${count === 1 ? "" : "s"}`,
			format: "pre",
		};
	}
	return { text: "", format: "pre" };
}

function formatToolResult(
	toolName: string,
	result: unknown,
	options: { args?: unknown; isError?: boolean } = {},
): { text: string; format?: "pre" | "diff" | "code" } {
	const record = asRecord(result);
	const details = asRecord(record?.details);
	if (toolName === "edit" && typeof details?.patch === "string") {
		return { text: details.patch, format: "diff" };
	}
	if (toolName === "edit" && typeof details?.diff === "string") {
		return { text: details.diff, format: "diff" };
	}
	if (toolName === "read") {
		return {
			text: options.isError ? compactReadOutput(extractToolText(result)) : "",
			format: "pre",
		};
	}
	if (toolName === "bash") {
		return { text: compactToolOutput(extractToolText(result)), format: "code" };
	}
	return { text: extractToolText(result), format: "pre" };
}

function shortenPath(path: string): string {
	return formatHomePath(path);
}

function compactReadOutput(text: string): string {
	return text
		.replace(/\n\n\[[^\]]*more lines in file[\s\S]*?\]$/i, "")
		.replace(/\n\n\[Showing lines [^\]]+\]$/i, "")
		.trimEnd();
}

function compactToolOutput(text: string): string {
	const trimmed = text.trimEnd();
	const lines = trimmed.split("\n");
	if (lines.length <= bashCompactThreshold) {
		return trimmed;
	}
	const skipped = lines.length - bashPreviewLines;
	return `... (${skipped} earlier lines)\n${lines.slice(-bashPreviewLines).join("\n")}`;
}

function extractToolText(result: unknown): string {
	const record = asRecord(result);
	if (record?.content !== undefined) {
		const text = contentToText(record.content);
		if (text.trim()) return text;
		if (Array.isArray(record.content) && record.content.length === 0) return "";
	}
	if (record?.text !== undefined) {
		return stripAnsi(String(record.text));
	}
	if (result instanceof Error) {
		return result.message;
	}
	if (typeof result === "string") {
		return stripAnsi(result);
	}
	return summarizeValue(result);
}

function stringValue(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return isRecord(value) ? value : undefined;
}

function contentToText(content: unknown): string {
	if (typeof content === "string") {
		return stripAnsi(content);
	}
	if (!Array.isArray(content)) {
		return summarizeValue(content);
	}
	return content
		.map((part) => {
			if (isRecord(part) && part.type === "text" && typeof part.text === "string") {
				return stripAnsi(part.text);
			}
			if (isRecord(part) && part.type === "image") {
				return `[image: ${String(part.mimeType ?? "unknown")}]`;
			}
			if (isRecord(part) && part.type === "thinking") {
				return "";
			}
			if (isRecord(part) && part.type === "toolCall") {
				return "";
			}
			return summarizeValue(part);
		})
		.filter(Boolean)
		.join("\n");
}

const ansiPattern = new RegExp(
	String.raw`[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))`,
	"g",
);

function stripAnsi(value: string): string {
	return value.replace(ansiPattern, "");
}

function summarizeValue(value: unknown): string {
	if (typeof value === "string") {
		return value;
	}
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
