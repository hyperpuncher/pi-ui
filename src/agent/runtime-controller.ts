import {
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
	getAgentDir,
	SessionManager,
	type AgentSessionEvent,
	type AgentSessionRuntime,
	type CreateAgentSessionRuntimeFactory,
} from "@earendil-works/pi-coding-agent";

import { sessionPerformance } from "../perf/session-performance.ts";
import { AppStore, type AppSessionSummary } from "../state/app-store.ts";
import { TranscriptState } from "../state/transcript-state.ts";
import { applyHttpProxySetting, configureHttpDispatcher } from "../utils/http-proxy.ts";
import { moveToTrash } from "../utils/trash.ts";
import { defaultWorkspacePath, formatHomePath } from "../utils/workspace.ts";
import { AuthController } from "./auth-controller.ts";
import {
	ownsForegroundGeneration,
	RuntimeOwnershipInvariantError,
} from "./background-runtime-ownership.ts";
import {
	BackgroundSessionController,
	type BackgroundSession,
} from "./background-session-controller.ts";
import { mergeBackgroundSessionStatuses } from "./background-session-status.ts";
import { ModelController, resolveScopedModels } from "./model-controller.ts";
import { SessionCatalog, type PreparedSessionList } from "./session-catalog.ts";
import {
	reduceSessionEvent,
	type SessionEventStateSink,
	type SessionEventToolState,
} from "./session-event-reducer.ts";
import { executeSessionResume } from "./session-resume.ts";
import {
	SessionTransitionController,
	type SessionTransitionResult,
} from "./session-transition-controller.ts";
import { transitionRuntime } from "./session-transition.ts";
import {
	formatError,
	formatToolResult,
	formatToolStart,
	toolEndMeta,
	toolMeta,
	toolTitle,
	toolTitleParts,
} from "./tool-presentation.ts";
import { TranscriptProjector } from "./transcript-projector.ts";
import { TreeProjector } from "./tree-projector.ts";
import { UsageController } from "./usage-controller.ts";

export type RuntimeControllerActivationOptions = {
	patchSessionMessages?: boolean;
	refreshWorkspaces?: boolean;
	transitionController?: SessionTransitionController;
};

export class RuntimeController {
	private unsubscribe: (() => void) | undefined;
	private readonly toolMessageIds = new Map<string, string>();
	private readonly toolCallArgs = new Map<string, unknown>();
	private readonly toolStartedAt = new Map<string, number>();
	private readonly auth: AuthController;
	private readonly transitionController: SessionTransitionController;
	private readonly backgroundSessions = new BackgroundSessionController();
	private readonly catalog: SessionCatalog;
	private readonly models: ModelController;
	private readonly usage: UsageController;
	private readonly transcript = new TranscriptProjector();
	private readonly tree: TreeProjector;
	private foregroundGeneration: number;
	private foregroundObservedRunning: boolean;

	private constructor(
		private runtime: AgentSessionRuntime,
		private readonly state: AppStore,
		private readonly runtimeFactory: CreateAgentSessionRuntimeFactory,
		private readonly preparedSessions: PreparedSessionList,
		private readonly activationOptions: RuntimeControllerActivationOptions,
	) {
		this.foregroundGeneration = this.backgroundSessions.allocateGeneration();
		this.foregroundObservedRunning = runtime.session.isStreaming;
		this.models = new ModelController(
			() => this.runtime,
			state,
			() => this.afterModelChange(),
		);
		this.usage = new UsageController(() => this.runtime, state);
		this.tree = new TreeProjector(
			() => this.runtime,
			state,
			() => this.loadCurrentSessionMessages(),
		);
		this.catalog = new SessionCatalog(state, (sessions) =>
			this.mergeBackgroundStatuses(sessions),
		);
		this.auth = new AuthController(
			() => this.runtime,
			state,
			() => this.models.sync(),
		);
		this.transitionController =
			activationOptions.transitionController ??
			new SessionTransitionController((transition) =>
				state.setSessionTransition(transition),
			);
	}

	static async create(
		state: AppStore,
		cwd = defaultWorkspacePath(),
		options: RuntimeControllerActivationOptions = {},
	): Promise<RuntimeController> {
		const host = await RuntimeController.prepare(state, cwd, options);
		host.activate();
		return host;
	}

	static async prepare(
		state: AppStore,
		cwd = defaultWorkspacePath(),
		options: RuntimeControllerActivationOptions = {},
	): Promise<RuntimeController> {
		const sessionsPromise = SessionCatalog.prepare();
		const createRuntime: CreateAgentSessionRuntimeFactory = async ({
			cwd,
			sessionManager,
			sessionStartEvent,
		}) => {
			const services = await sessionPerformance.measure(
				"runtimeServicesCreate",
				() => createAgentSessionServices({ cwd }),
			);
			applyHttpProxySetting(services.settingsManager.getGlobalSettings().httpProxy);
			configureHttpDispatcher(services.settingsManager.getHttpIdleTimeoutMs());
			const scopedModels = sessionPerformance.measureSync(
				"scopedModelResolution",
				() =>
					resolveScopedModels(
						services.settingsManager.getEnabledModels() ?? [],
						services.modelRegistry
							.getAll()
							.filter((model) =>
								services.modelRegistry.hasConfiguredAuth(model),
							),
					),
			);
			const session = await sessionPerformance.measure("runtimeSessionCreate", () =>
				createAgentSessionFromServices({
					services,
					sessionManager,
					sessionStartEvent,
					scopedModels,
				}),
			);
			return {
				...session,
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
			const host = new RuntimeController(
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
		this.bindSessionState({ syncSessions: false });
		this.catalog.applyPrepared(this.preparedSessions, {
			refreshWorkspaces: this.activationOptions.refreshWorkspaces,
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

		if (trimmed === "/login" || trimmed.startsWith("/login ")) {
			this.openLogin(
				trimmed.startsWith("/login ") ? trimmed.slice(7).trim() : undefined,
			);
			return true;
		}

		if (trimmed === "/logout") {
			this.openLogout();
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
		this.tree.cancelNavigation();
		await this.runtime.session.abort();
		this.foregroundObservedRunning = false;
		this.state.setActivityText(undefined);
		this.state.setQueuedMessages([], []);
		this.loadCurrentSessionMessages();
		this.syncUsage();
	}

	async abortBackgroundSession(sessionPath: string): Promise<boolean> {
		const session = this.backgroundSessions.get(sessionPath);
		if (session?.status !== "running") return false;
		await session.runtime.session.abort();
		session.status = "completed";
		session.observedRunning = false;
		this.syncBackgroundStatuses();
		await this.refreshSessions();
		return true;
	}

	restoreQueuedMessages(): string {
		const { steering, followUp } = this.runtime.session.clearQueue();
		this.state.setQueuedMessages([], []);
		return [...steering, ...followUp].join("\n\n");
	}

	async newSession(): Promise<SessionTransitionResult> {
		return await this.transitionController.run("New session", () =>
			this.createNewSession(),
		);
	}

	private async createNewSession(): Promise<boolean> {
		const session = this.runtime.session;
		const persisted = session.sessionManager.isPersisted();
		const active = this.isCurrentRuntimeActive();
		if (active || !persisted) {
			const cwd = session.sessionManager.getCwd();
			if (active && persisted) {
				this.backgroundCurrentRuntime();
			} else if (active) {
				await this.discardTemporaryRuntime();
			} else {
				this.unbindSession();
				await this.runtime.dispose();
			}
			const runtime = await createAgentSessionRuntime(this.runtimeFactory, {
				cwd,
				agentDir: getAgentDir(),
				sessionManager: SessionManager.create(cwd),
				sessionStartEvent: { type: "session_start", reason: "new" },
			});
			this.runtime = runtime;
			this.assignNewForegroundGeneration();
			this.bindRuntimeCallbacks(runtime);
		} else {
			const result = await this.runtime.newSession();
			if (result.cancelled) {
				return false;
			}
			this.assignNewForegroundGeneration();
			// SDK in-place replacement overwrites lifecycle callbacks before returning.
			this.bindRuntimeCallbacks(this.runtime);
		}
		this.state.resetChat();
		await this.bindSession({ refreshSessions: true });
		return true;
	}

	async newTemporarySession(): Promise<SessionTransitionResult> {
		return await this.transitionController.run("New temporary session", () =>
			this.createNewTemporarySession(),
		);
	}

	private async createNewTemporarySession(): Promise<boolean> {
		const previousSessionFile = this.runtime.session.sessionManager.getSessionFile();
		const cwd = this.runtime.session.sessionManager.getCwd();
		if (this.isCurrentRuntimeActive()) {
			if (this.runtime.session.sessionManager.isPersisted()) {
				this.backgroundCurrentRuntime();
			} else {
				await this.discardTemporaryRuntime();
			}
		} else {
			this.unbindSession();
			await this.runtime.dispose();
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
		this.assignNewForegroundGeneration();
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
		if (this.backgroundSessions.get(targetSessionFile)?.status === "running") {
			this.state.appendMessage(
				"system",
				"Cannot delete a running background session.",
			);
			return false;
		}
		try {
			await moveToTrash(targetSessionFile);
			const backgroundSession = this.backgroundSessions.get(targetSessionFile);
			if (backgroundSession) {
				this.unsubscribeBackgroundSession(backgroundSession);
				await backgroundSession.runtime.dispose();
				this.backgroundSessions.delete(targetSessionFile);
			}
			this.state.removeSession(targetSessionFile);
			await this.refreshSessions();
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

	async resumeSession(sessionPath: string): Promise<SessionTransitionResult> {
		return await this.transitionController.run(sessionPath, async () => {
			const transitionId = sessionPerformance.startSessionTransition();
			try {
				const resumed = await sessionPerformance.runInTransition(
					transitionId,
					() => this.resumeSessionTransition(sessionPath, transitionId),
				);
				if (resumed) {
					sessionPerformance.markSessionTransitionComplete(transitionId);
				} else {
					sessionPerformance.cancelSessionTransition(transitionId);
				}
				return resumed;
			} catch (error) {
				sessionPerformance.cancelSessionTransition(transitionId);
				throw error;
			}
		});
	}

	private async resumeSessionTransition(
		sessionPath: string,
		transitionId?: number,
	): Promise<boolean> {
		const sourceStreaming = this.runtime.session.isStreaming;
		const sourcePersisted = this.runtime.session.sessionManager.isPersisted();
		sessionPerformance.recordOwnershipDiagnostics(
			{
				sourceGeneration: this.foregroundGeneration,
				sourceSdkStreaming: sourceStreaming,
				sourceObservedRunning: this.foregroundObservedRunning,
				sourcePersisted,
				sourceLocationBefore: "foreground",
				ownedLiveRuntimeCount: this.ownedLiveRuntimeCount(),
				duplicateKeyInvariantFailures:
					this.backgroundSessions.invariantFailureCount,
			},
			transitionId,
		);
		const resumed = await executeSessionResume(sessionPath, {
			state: () => ({
				streaming: sourceStreaming,
				observedRunning: this.foregroundObservedRunning,
				persisted: sourcePersisted,
			}),
			findBackground: (path) => {
				const session = this.backgroundSessions.get(path);
				sessionPerformance.recordOwnershipDiagnostics(
					{
						targetBackgroundLookup: session ? "hit" : "miss",
						targetLocationBefore: session
							? session.status === "running"
								? "background-running"
								: "background-completed"
							: "disposed",
					},
					transitionId,
				);
				return session;
			},
			activateBackground: async (path, session) => {
				const activation = this.backgroundSessions.beginActivation(path);
				if (!activation || activation.runtime !== session) {
					throw new RuntimeOwnershipInvariantError();
				}
				const action = this.currentRuntimeLeaveAction();
				sessionPerformance.recordOwnershipDiagnostics(
					{ leaveAction: action },
					transitionId,
				);
				try {
					await sessionPerformance.measure(
						"backgroundActivation",
						() => this.activateRuntime(session),
						transitionId,
					);
					activation.commit();
					sessionPerformance.recordOwnershipDiagnostics(
						{
							sourceLocationAfter: this.leaveActionLocation(action),
							targetLocationAfter: "foreground",
						},
						transitionId,
					);
				} catch (error) {
					activation.rollback();
					throw error;
				}
			},
			openSession: (path) => {
				const manager = sessionPerformance.measureSync(
					"sessionManagerOpen",
					() => SessionManager.open(path),
					transitionId,
				);
				sessionPerformance.recordSessionOpen(transitionId);
				return manager;
			},
			replaceRuntime: async (sessionManager, action) => {
				sessionPerformance.recordOwnershipDiagnostics(
					{ leaveAction: action },
					transitionId,
				);
				if (action === "background") {
					this.backgroundCurrentRuntime();
				} else if (action === "discard") {
					await this.discardTemporaryRuntime();
				} else {
					this.unbindSession();
					await this.runtime.dispose();
				}
				this.runtime = await sessionPerformance.measure(
					"runtimeSwitchCreate",
					() =>
						createAgentSessionRuntime(this.runtimeFactory, {
							cwd: sessionManager.getCwd(),
							agentDir: getAgentDir(),
							sessionManager,
						}),
					transitionId,
				);
				this.assignNewForegroundGeneration();
				this.bindRuntimeCallbacks(this.runtime);
				await sessionPerformance.measure(
					"runtimeRebind",
					() => this.bindSession(),
					transitionId,
				);
				this.loadCurrentSessionMessages();
				sessionPerformance.recordOwnershipDiagnostics(
					{
						sourceLocationAfter: this.leaveActionLocation(action),
						targetLocationAfter: "foreground",
					},
					transitionId,
				);
			},
			switchSession: async (path) => {
				sessionPerformance.recordOwnershipDiagnostics(
					{ leaveAction: "dispose" },
					transitionId,
				);
				const result = await sessionPerformance.measure(
					"runtimeSwitchCreate",
					() => this.runtime.switchSession(path),
					transitionId,
				);
				if (!result.cancelled) {
					sessionPerformance.recordSessionOpen(transitionId);
					this.assignNewForegroundGeneration();
					this.bindRuntimeCallbacks(this.runtime);
					sessionPerformance.recordOwnershipDiagnostics(
						{
							sourceLocationAfter: "disposed",
							targetLocationAfter: "foreground",
						},
						transitionId,
					);
				}
				return result;
			},
		});
		sessionPerformance.recordOwnershipDiagnostics(
			{
				ownedLiveRuntimeCount: this.ownedLiveRuntimeCount(),
				duplicateKeyInvariantFailures:
					this.backgroundSessions.invariantFailureCount,
			},
			transitionId,
		);
		return resumed;
	}

	openTree(): boolean {
		this.tree.open();
		return true;
	}

	async navigateTree(
		entryId: string,
		options: { summarize?: boolean; customInstructions?: string } = {},
	): Promise<string | undefined> {
		return await this.tree.navigate(entryId, options);
	}

	async setThinkingLevel(level: string): Promise<boolean> {
		return this.models.setThinking(level);
	}

	cycleThinkingLevel(direction: "forward" | "backward" = "forward"): boolean {
		return this.models.cycleThinking(direction);
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

	openLogin(providerRef?: string): void {
		this.auth.openLogin(providerRef);
	}

	openLogout(): void {
		this.auth.openLogout();
	}

	startLogin(providerId: string, authType: string): boolean {
		return this.auth.startLogin(providerId, authType);
	}

	submitAuthInput(value: string): boolean {
		return this.auth.submitInput(value);
	}

	logout(providerId: string): boolean {
		return this.auth.logout(providerId);
	}

	closeAuth(): void {
		this.auth.close();
	}

	async setModel(modelRef: string): Promise<boolean> {
		return await this.models.set(modelRef);
	}

	async cycleModel(direction: "forward" | "backward" = "forward"): Promise<boolean> {
		return await this.models.cycle(direction);
	}

	async toggleScopedModel(modelRef: string): Promise<boolean> {
		return await this.models.toggleScoped(modelRef);
	}

	dispose(): void {
		this.unsubscribe?.();
		this.auth.dispose();
		this.usage.dispose();
		this.runtime.dispose();
		for (const session of this.backgroundSessions.values()) {
			this.unsubscribeBackgroundSession(session);
			session.runtime.dispose();
		}
		this.backgroundSessions.clear();
	}

	private isCurrentRuntimeActive(): boolean {
		return this.runtime.session.isStreaming || this.foregroundObservedRunning;
	}

	private currentRuntimeLeaveAction(): "background" | "discard" | "dispose" {
		if (!this.isCurrentRuntimeActive()) return "dispose";
		return this.runtime.session.sessionManager.isPersisted()
			? "background"
			: "discard";
	}

	private leaveActionLocation(
		action: "background" | "discard" | "dispose" | "keep",
	): "background-running" | "disposed" | "foreground" {
		if (action === "background") return "background-running";
		if (action === "keep") return "foreground";
		return "disposed";
	}

	private assignNewForegroundGeneration(): void {
		this.foregroundGeneration = this.backgroundSessions.allocateGeneration();
		this.foregroundObservedRunning = this.runtime.session.isStreaming;
	}

	private ownedLiveRuntimeCount(): number {
		return this.backgroundSessions.liveCount(this.isCurrentRuntimeActive());
	}

	private unsubscribeBackgroundSession(session: BackgroundSession): void {
		this.backgroundSessions.unsubscribe(session);
	}

	private bindRuntimeCallbacks(runtime: AgentSessionRuntime): void {
		const generation = this.foregroundGeneration;
		const ownsForeground = () =>
			ownsForegroundGeneration(
				this.runtime,
				this.foregroundGeneration,
				runtime,
				generation,
			);
		runtime.setBeforeSessionInvalidate(() => {
			// Delayed shutdown from an old generation must not detach its successor.
			if (ownsForeground()) this.unbindSession();
		});
		runtime.setRebindSession(async () => {
			if (!ownsForeground()) return;
			await sessionPerformance.measure("runtimeRebind", async () => {
				if (!ownsForeground()) return;
				await this.bindSessionExtensions();
				if (!ownsForeground()) return;
				this.bindSessionState();
				this.loadCurrentSessionMessages();
			});
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
		const sessionFile = this.runtime.session.sessionManager.getSessionFile();
		if (!sessionFile) return;
		if (this.backgroundSessions.has(sessionFile)) {
			throw new RuntimeOwnershipInvariantError();
		}
		const snapshot = this.state.snapshotChat();
		const backgroundGeneration = this.foregroundGeneration;
		const backgroundObservedRunning = this.foregroundObservedRunning;
		// Invalidate foreground callbacks before replacement creation can await.
		this.foregroundGeneration = this.backgroundSessions.allocateGeneration();
		this.foregroundObservedRunning = false;
		this.unbindSession();
		this.state.setQueuedMessages([], []);
		const backgroundState = new TranscriptState(snapshot.emptyChatHint);
		backgroundState.restore(snapshot);
		const backgroundSession: BackgroundSession = {
			runtime: this.runtime,
			state: backgroundState,
			status: "running",
			generation: backgroundGeneration,
			observedRunning: backgroundObservedRunning,
			toolMessageIds: new Map(this.toolMessageIds),
			toolCallArgs: new Map(this.toolCallArgs),
			toolStartedAt: new Map(this.toolStartedAt),
			unsubscribe: () => {},
		};
		backgroundSession.unsubscribe = this.runtime.session.subscribe((event) =>
			this.handleBackgroundEvent(backgroundSession, event),
		);
		this.backgroundSessions.register(sessionFile, backgroundSession);
		this.state.setCurrentSessionPath(undefined);
		this.syncBackgroundStatuses();
	}

	private handleBackgroundEvent(
		backgroundSession: BackgroundSession,
		event: AgentSessionEvent,
	): void {
		if (event.type === "agent_start") backgroundSession.observedRunning = true;
		if (event.type === "agent_end") backgroundSession.observedRunning = false;
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
			this.unsubscribeBackgroundSession(backgroundSession);
			backgroundSession.status = "completed";
			this.syncBackgroundStatuses();
			this.notifyBackgroundSessionDone(backgroundSession.runtime);
			void this.refreshSessions();
			return;
		}
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
		if (this.isCurrentRuntimeActive()) {
			if (this.runtime.session.sessionManager.isPersisted()) {
				this.backgroundCurrentRuntime();
			} else {
				await this.discardTemporaryRuntime();
			}
		} else {
			this.unbindSession();
			await this.runtime.dispose();
		}
		this.unsubscribeBackgroundSession(backgroundSession);
		this.runtime = backgroundSession.runtime;
		this.foregroundGeneration = backgroundSession.generation;
		this.foregroundObservedRunning = backgroundSession.observedRunning;
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
		this.bindSessionState({ resetToolState: false, syncSessions: false });
		this.state.restoreChat(backgroundSession.state.snapshot());
		this.syncBackgroundStatuses();
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
		options: {
			resetToolState?: boolean;
			refreshSessions?: boolean;
			syncSessions?: boolean;
		} = {},
	): void {
		this.state.update(() => {
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
			this.state.setActivityText(
				session.isStreaming || this.foregroundObservedRunning
					? "Working..."
					: undefined,
			);
			this.syncModels();
			this.syncThinking();
			this.syncSlashCommands();
			this.syncUsage();
			this.refreshCodexUsage(true);
			if (options.syncSessions !== false) {
				this.syncBackgroundStatuses();
			}
			if (options.refreshSessions === true) {
				void this.refreshSessions();
			}
		});
	}

	private async bindSessionExtensions(): Promise<void> {
		await sessionPerformance.measure("extensionBind", () =>
			this.runtime.session.bindExtensions({ mode: "rpc" }),
		);
	}

	private async refreshSessions(): Promise<void> {
		await this.catalog.refresh();
	}

	private syncBackgroundStatuses(): void {
		this.catalog.mergeCurrentStatuses();
	}

	private mergeBackgroundStatuses(
		sessions: readonly AppSessionSummary[],
	): AppSessionSummary[] {
		return mergeBackgroundSessionStatuses(
			sessions,
			new Map(
				[...this.backgroundSessions.entries()].map(([path, session]) => [
					path,
					session.status,
				]),
			),
			this.state.currentSessionPath,
		);
	}

	private afterModelChange(): void {
		this.usage.reset();
		this.models.sync();
		this.models.syncThinking();
		this.usage.sync();
		this.usage.refresh(true);
	}

	private syncModels(options: { reopenPicker?: boolean } = {}): void {
		this.models.sync(options);
	}

	private handleEvent(event: AgentSessionEvent): void {
		if (event.type === "agent_start") this.foregroundObservedRunning = true;
		if (event.type === "agent_end") this.foregroundObservedRunning = false;
		this.state.update(
			() => {
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
			},
			// Streaming deltas use the documented targeted-message patch path.
			{ commit: false },
		);
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
				this.transcript.message(message, timestamp),
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
		this.models.syncThinking();
	}

	private syncUsage(): void {
		this.usage.sync();
	}

	private resetCodexUsage(): void {
		this.usage.reset();
	}

	private refreshCodexUsage(force = false): void {
		this.usage.refresh(force);
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
				name: "login",
				description: "Log in with a subscription or API key",
				source: "system" as const,
				argumentHint: "[provider]",
			},
			{
				name: "logout",
				description: "Remove stored provider credentials",
				source: "system" as const,
			},
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
		this.tree.open();
	}

	private loadCurrentSessionMessages(): void {
		this.loadRuntimeMessages(this.runtime, this.state);
		this.syncUsage();
	}

	private loadRuntimeMessages(
		runtime: AgentSessionRuntime,
		state: AppStore | TranscriptState,
	): void {
		this.transcript.load(runtime, state);
	}
}
