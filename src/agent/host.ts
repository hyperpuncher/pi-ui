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
import {
	codexUsageTtlMs,
	fetchCodexUsage,
	formatCodexUsage,
	isOpenAICodex,
	type CodexUsage,
} from "./codex-usage.ts";

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

export class AgentHost {
	private unsubscribe: (() => void) | undefined;
	private readonly toolMessageIds = new Map<string, string>();
	private readonly toolCallArgs = new Map<string, unknown>();
	private readonly toolStartedAt = new Map<string, number>();
	private codexUsageText = "";
	private codexUsage: CodexUsage | undefined;
	private codexUsageFetchedAt = 0;
	private codexUsageFetching = false;
	private codexUsageTimer: ReturnType<typeof setTimeout> | undefined;

	private readonly backgroundSessions = new Map<string, BackgroundSession>();

	private constructor(
		private runtime: AgentSessionRuntime,
		private readonly state: AppState,
		private readonly runtimeFactory: CreateAgentSessionRuntimeFactory,
	) {}

	static async create(
		state: AppState,
		cwd = defaultWorkspacePath(),
	): Promise<AgentHost> {
		state.setWorkspacePath(cwd);
		const sessionsPromise = SessionManager.listAll();
		const createRuntime: CreateAgentSessionRuntimeFactory = async ({
			cwd,
			sessionManager,
			sessionStartEvent,
		}) => {
			const services = await createAgentSessionServices({ cwd });
			applyHttpProxySetting(services.settingsManager.getGlobalSettings().httpProxy);
			configureHttpDispatcher(services.settingsManager.getHttpIdleTimeoutMs());
			return {
				...(await createAgentSessionFromServices({
					services,
					sessionManager,
					sessionStartEvent,
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

		const host = new AgentHost(runtime, state, createRuntime);
		host.bindRuntimeCallbacks(runtime);
		await host.bindSession({ refreshSessions: false });
		try {
			const sessions = await sessionsPromise;
			state.setRecentWorkspaces(recentSessionWorkspaces(sessions));
			state.setSessions(sessions.slice(0, 50).map(formatSessionSummary));
		} catch (error) {
			state.appendMessage(
				"system",
				`Failed to list sessions: ${formatError(error)}`,
			);
		}
		return host;
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
		if (!this.runtime.session.sessionManager.isPersisted()) {
			if (this.runtime.session.isStreaming) {
				this.state.appendMessage(
					"system",
					"Cannot start a saved chat while this temporary chat is running.",
				);
				return false;
			}

			const cwd = this.runtime.session.sessionManager.getCwd();
			this.unbindSession();
			this.runtime.dispose();
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
			if (!this.runtime.session.sessionManager.getSessionFile()) {
				this.state.appendMessage(
					"system",
					"Cannot start another temporary chat while this temporary chat is running.",
				);
				return false;
			}
			this.backgroundCurrentRuntime();
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
			this.activateRuntime(backgroundSession);
			return true;
		}

		if (this.runtime.session.isStreaming) {
			this.backgroundCurrentRuntime();
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

	cycleThinkingLevel(): boolean {
		const level = this.runtime.session.cycleThinkingLevel();
		if (!level) {
			return false;
		}
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
		const [provider, ...idParts] = modelRef.split("/");
		const modelId = idParts.join("/");
		if (!provider || !modelId) {
			return false;
		}
		const model = this.runtime.session.modelRegistry.find(provider, modelId);
		if (!model) {
			this.state.appendMessage("system", `Model not found: ${modelRef}`);
			return false;
		}
		await this.runtime.session.setModel(model);
		this.codexUsageText = "";
		this.codexUsage = undefined;
		this.codexUsageFetchedAt = 0;
		this.syncModels();
		this.syncThinking();
		this.syncUsage();
		this.refreshCodexUsage(true);
		return true;
	}

	dispose(): void {
		this.unsubscribe?.();
		this.clearCodexUsageTimer();
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
			this.bindSessionState();
			this.loadCurrentSessionMessages();
			await this.bindSessionExtensions();
		});
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
		switch (event.type) {
			case "agent_start":
				backgroundSession.state.setActivityText("Working...");
				break;
			case "message_start":
				this.handleMessageStart(event.message, backgroundSession.state);
				break;
			case "message_update":
				if (event.assistantMessageEvent.type === "thinking_delta") {
					backgroundSession.state.appendThoughtDelta(
						event.assistantMessageEvent.delta,
					);
				}
				if (event.assistantMessageEvent.type === "text_delta") {
					backgroundSession.state.appendAssistantDelta(
						event.assistantMessageEvent.delta,
					);
				}
				break;
			case "message_end":
				if (event.message.role === "assistant") {
					backgroundSession.state.finishAssistant();
				}
				break;
			case "tool_execution_start": {
				backgroundSession.state.finishAssistant();
				backgroundSession.toolCallArgs.set(event.toolCallId, event.args);
				backgroundSession.toolStartedAt.set(event.toolCallId, Date.now());
				const startView = formatToolStart(event.toolName, event.args);
				const id = backgroundSession.state.appendMessage("tool", startView.text, {
					title: toolTitle("running", event.toolName, event.args),
					titleParts: toolTitleParts(event.toolName, event.args),
					meta: toolMeta(event.toolName, event.args) ?? "Running...",
					state: "running",
					format: startView.format,
				});
				backgroundSession.toolMessageIds.set(event.toolCallId, id);
				break;
			}
			case "tool_execution_update": {
				const id = backgroundSession.toolMessageIds.get(event.toolCallId);
				if (id) {
					backgroundSession.state.updateMessage(id, {
						text: formatToolResult(event.toolName, event.partialResult, {
							args: event.args,
						}).text,
						meta: toolMeta(event.toolName, event.args),
					});
				}
				break;
			}
			case "tool_execution_end": {
				const id = backgroundSession.toolMessageIds.get(event.toolCallId);
				const args = backgroundSession.toolCallArgs.get(event.toolCallId) ?? {};
				const resultView = formatToolResult(event.toolName, event.result, {
					args,
					isError: event.isError,
				});
				const startedAt = backgroundSession.toolStartedAt.get(event.toolCallId);
				const patch = {
					text: resultView.text,
					title: toolTitle(
						event.isError ? "error" : "success",
						event.toolName,
						args,
					),
					meta: toolEndMeta(startedAt),
					state: event.isError ? "error" : "success",
					titleParts: toolTitleParts(event.toolName, args),
					format: resultView.format,
				} as const;
				if (id) {
					backgroundSession.state.updateMessage(id, patch);
					backgroundSession.toolMessageIds.delete(event.toolCallId);
				} else {
					backgroundSession.state.appendMessage("tool", patch.text, patch);
				}
				backgroundSession.toolCallArgs.delete(event.toolCallId);
				backgroundSession.toolStartedAt.delete(event.toolCallId);
				break;
			}
			case "queue_update":
				backgroundSession.state.setQueuedMessages(event.steering, event.followUp);
				break;
			case "agent_end":
				backgroundSession.state.setActivityText(undefined);
				backgroundSession.unsubscribe();
				this.notifyBackgroundSessionDone(backgroundSession.runtime);
				void this.refreshSessions();
				break;
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

	private activateRuntime(backgroundSession: BackgroundSession): void {
		if (this.runtime.session.isStreaming) {
			this.backgroundCurrentRuntime();
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
		this.bindSessionState(options);
		await this.bindSessionExtensions();
	}

	private unbindSession(): void {
		this.unsubscribe?.();
		this.unsubscribe = undefined;
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

	private syncModels(): void {
		const session = this.runtime.session;
		const currentModel = session.model
			? `${session.model.provider}/${session.model.id}`
			: undefined;
		const models = session.modelRegistry
			.getAll()
			.map((model) => ({
				id: model.id,
				provider: model.provider,
				name: model.name ?? model.id,
				configured: session.modelRegistry.hasConfiguredAuth(model),
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
		this.state.setModels(models, currentModel);
	}

	private handleEvent(event: AgentSessionEvent): void {
		switch (event.type) {
			case "agent_start":
				this.state.setActivityText("Working...");
				break;
			case "message_start":
				this.handleMessageStart(event.message);
				break;
			case "message_update":
				if (event.assistantMessageEvent.type === "thinking_delta") {
					this.state.appendThoughtDelta(event.assistantMessageEvent.delta);
				}
				if (event.assistantMessageEvent.type === "text_delta") {
					this.state.appendAssistantDelta(event.assistantMessageEvent.delta);
				}
				break;
			case "message_end":
				if (event.message.role === "assistant") {
					this.state.finishAssistant();
				}
				this.syncUsage();
				break;
			case "tool_execution_start": {
				this.state.finishAssistant();
				this.toolCallArgs.set(event.toolCallId, event.args);
				this.toolStartedAt.set(event.toolCallId, Date.now());
				const startView = formatToolStart(event.toolName, event.args);
				const id = this.state.appendMessage("tool", startView.text, {
					title: toolTitle("running", event.toolName, event.args),
					titleParts: toolTitleParts(event.toolName, event.args),
					meta: toolMeta(event.toolName, event.args) ?? "Running...",
					state: "running",
					format: startView.format,
				});
				this.toolMessageIds.set(event.toolCallId, id);
				break;
			}
			case "tool_execution_update": {
				const id = this.toolMessageIds.get(event.toolCallId);
				if (id) {
					this.state.updateMessage(id, {
						text: formatToolResult(event.toolName, event.partialResult, {
							args: event.args,
						}).text,
						meta: toolMeta(event.toolName, event.args),
					});
				}
				break;
			}
			case "tool_execution_end": {
				const id = this.toolMessageIds.get(event.toolCallId);
				const args = this.toolCallArgs.get(event.toolCallId) ?? {};
				const resultView = formatToolResult(event.toolName, event.result, {
					args,
					isError: event.isError,
				});
				const startedAt = this.toolStartedAt.get(event.toolCallId);
				const patch = {
					text: resultView.text,
					title: toolTitle(
						event.isError ? "error" : "success",
						event.toolName,
						args,
					),
					meta: toolEndMeta(startedAt),
					state: event.isError ? "error" : "success",
					titleParts: toolTitleParts(event.toolName, args),
					format: resultView.format,
				} as const;
				if (id) {
					this.state.updateMessage(id, patch);
					this.toolMessageIds.delete(event.toolCallId);
				} else {
					this.state.appendMessage("tool", patch.text, patch);
				}
				this.toolCallArgs.delete(event.toolCallId);
				this.toolStartedAt.delete(event.toolCallId);
				break;
			}
			case "agent_end":
				this.state.setActivityText(undefined);
				this.syncUsage();
				this.refreshCodexUsage(true);
				break;
			case "queue_update":
				this.state.setQueuedMessages(event.steering, event.followUp);
				break;
			case "auto_retry_start":
				this.state.setActivityText(
					`Retrying (${event.attempt}/${event.maxAttempts})...`,
				);
				break;
			case "auto_retry_end":
				this.state.setActivityText(undefined);
				break;
			case "compaction_start":
				this.state.setActivityText(
					event.reason === "manual"
						? "Compacting context..."
						: `${event.reason === "overflow" ? "Context overflow detected, " : ""}Auto-compacting...`,
				);
				break;
			case "compaction_end":
				this.state.setActivityText(undefined);
				if (event.result) {
					this.loadCurrentSessionMessages();
				}
				if (event.errorMessage) {
					this.state.appendMessage("system", event.errorMessage);
				}
				break;
		}
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

	private scheduleCodexUsageRefresh(): void {
		this.clearCodexUsageTimer();
		this.codexUsageTimer = setTimeout(() => {
			this.codexUsageTimer = undefined;
			this.refreshCodexUsage(true);
		}, codexUsageTtlMs);
		this.codexUsageTimer.unref?.();
	}

	private refreshCodexUsage(force = false): void {
		if (!isOpenAICodex(this.runtime.session.model)) {
			this.codexUsageText = "";
			this.codexUsage = undefined;
			this.codexUsageFetchedAt = 0;
			this.clearCodexUsageTimer();
			this.syncUsage();
			return;
		}
		if (this.codexUsageFetching) return;
		if (!force && Date.now() - this.codexUsageFetchedAt < codexUsageTtlMs) {
			return;
		}

		this.codexUsageFetching = true;
		if (!this.codexUsageText) {
			this.codexUsageText = "loading";
			this.syncUsage();
		}
		void fetchCodexUsage(this.runtime.session)
			.then((usage) => {
				this.codexUsageText = usage ? formatCodexUsage(usage) : "unavailable";
				this.codexUsage = usage;
				this.codexUsageFetchedAt = Date.now();
				this.syncUsage();
			})
			.catch((error: unknown) => {
				console.warn("Failed to fetch Codex usage", error);
				this.codexUsageText = "unavailable";
				this.codexUsage = undefined;
				this.codexUsageFetchedAt = Date.now();
				this.syncUsage();
			})
			.finally(() => {
				this.codexUsageFetching = false;
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
		const branch = this.runtime.session.sessionManager.getBranch();
		const pendingToolCalls = new Map<string, { name: string; args: unknown }>();
		const messages = branch.flatMap((entry: SessionEntry) =>
			this.entryToMessages(entry, pendingToolCalls),
		);
		this.state.replaceMessages(messages);
		this.syncUsage();
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

	private handleMessageStart(
		message: Extract<AgentSessionEvent, { type: "message_start" }>["message"],
		state = this.state,
	): void {
		if (message.role === "toolResult") {
			return;
		}
		const appMessages = this.agentMessageToAppMessages(message, new Date());
		for (const appMessage of appMessages) {
			state.appendMessage(appMessage.role, appMessage.text, {
				title: appMessage.title,
				titleParts: appMessage.titleParts,
				meta: appMessage.meta,
				state: appMessage.state,
				format: appMessage.format,
			});
		}
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
