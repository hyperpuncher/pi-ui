import {
	type AgentSessionEvent,
	type AgentSessionRuntime,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	type CreateAgentSessionRuntimeFactory,
	createAgentSessionServices,
	getAgentDir,
	SessionManager,
} from "@earendil-works/pi-coding-agent";

import { sessionPerformance } from "../perf/session-performance.ts";
import { AppStore, type BackgroundSessionStatus } from "../state/app-store.ts";
import { TranscriptState } from "../state/transcript-state.ts";
import {
	notifySessionDone,
	type SessionDoneNotification,
} from "../system-notifications.ts";
import { errorMessage } from "../utils/errors.ts";
import { configureAgentHttpProxy, withAgentHttpProxy } from "../utils/http-proxy.ts";
import { moveToTrash } from "../utils/trash.ts";
import { defaultWorkspacePath, formatHomePath } from "../utils/workspace.ts";
import { AuthController } from "./auth-controller.ts";
import { type AutoTitleConfig, generateAutoTitle } from "./auto-title.ts";
import {
	BackgroundRuntimeOwnership,
	ownsForegroundGeneration,
	RuntimeOwnershipInvariantError,
} from "./background-runtime-ownership.ts";
import { detectCacheMiss, formatCacheMissNotice } from "./cache-miss.ts";
import { ExtensionUiController } from "./extension-ui-controller.ts";
import { LlamaController } from "./llama-controller.ts";
import { llamaProviderExtension } from "./llama-provider-extension.ts";
import { ModelController, resolveScopedModels } from "./model-controller.ts";
import {
	PromptLifecycle,
	type PromptStreamingBehavior,
	type RuntimePromptOptions,
} from "./prompt-lifecycle.ts";
import { createBunReadToolDefinition } from "./read-tool.ts";
import {
	type SessionCatalogWatch,
	watchSessionCatalog,
} from "./session-catalog-watcher.ts";
import { type PreparedSessionList, SessionCatalog } from "./session-catalog.ts";
import {
	clearSessionEventToolState,
	cloneSessionEventToolState,
	createSessionEventToolState,
	reduceSessionEvent,
	restoreSessionEventToolState,
	type SessionEventStateSink,
	type SessionEventToolState,
	type ToolArguments,
} from "./session-event-reducer.ts";
import { executeSessionResume } from "./session-resume.ts";
import { shareSession } from "./session-share.ts";
import {
	SessionTransitionController,
	type SessionTransitionResult,
} from "./session-transition-controller.ts";
import { transitionRuntime } from "./session-transition.ts";
import {
	formatToolResult,
	formatToolStart,
	toolEndMeta,
	toolMeta,
	toolTitle,
	toolTitleParts,
} from "./tool-presentation.ts";
import { TranscriptProjector } from "./transcript-projector.ts";
import { type TreeNavigationResult, TreeProjector } from "./tree-projector.ts";
import { UsageController } from "./usage-controller.ts";

const extensionFactories = [llamaProviderExtension];
const modelCatalogForceIntervalMs = 30 * 60 * 1000;

type BackgroundSession = {
	runtime: AgentSessionRuntime;
	state: TranscriptState;
	status: BackgroundSessionStatus;
	generation: number;
	observedRunning: boolean;
	tools: SessionEventToolState;
	unsubscribe: () => void;
};

export type RuntimeControllerDependencies = Readonly<{
	createRuntime: typeof createAgentSessionRuntime;
	prepareSessions: typeof SessionCatalog.prepare;
	refreshSessions: typeof SessionCatalog.prepare;
	createSessionManager: typeof SessionManager.create;
	createMemorySessionManager: typeof SessionManager.inMemory;
	forkSessionManager: typeof SessionManager.forkFrom;
	openSessionManager: typeof SessionManager.open;
	moveToTrash: typeof moveToTrash;
	shareSession: typeof shareSession;
	getAgentDir: typeof getAgentDir;
	notifySessionDone: typeof notifySessionDone;
	watchSessionCatalog?: SessionCatalogWatch;
}>;

const runtimeControllerDependencies: RuntimeControllerDependencies = {
	createRuntime: createAgentSessionRuntime,
	prepareSessions: SessionCatalog.prepare,
	refreshSessions: SessionCatalog.prepare,
	createSessionManager: SessionManager.create,
	createMemorySessionManager: SessionManager.inMemory,
	forkSessionManager: SessionManager.forkFrom,
	openSessionManager: SessionManager.open,
	moveToTrash,
	shareSession,
	getAgentDir,
	notifySessionDone,
	watchSessionCatalog,
};

export type RuntimeControllerActivationOptions = {
	refreshWorkspaces?: boolean;
	transitionController?: SessionTransitionController;
	dependencies?: RuntimeControllerDependencies;
	isApplicationFocused?: () => boolean | Promise<boolean>;
	notifySessionDone?: (details: SessionDoneNotification) => Promise<void>;
	autoTitle?: AutoTitleConfig;
};

export class RuntimeController {
	private unsubscribe: (() => void) | undefined;
	private readonly tools = createSessionEventToolState();
	private readonly prompts: PromptLifecycle;
	private readonly auth: AuthController;
	private readonly transitionController: SessionTransitionController;
	private readonly backgroundSessions =
		new BackgroundRuntimeOwnership<BackgroundSession>();
	private readonly catalog: SessionCatalog;
	private readonly llama: LlamaController;
	private readonly models: ModelController;
	private readonly usage: UsageController;
	private readonly extensionUi: ExtensionUiController;
	private readonly transcript = new TranscriptProjector();
	private readonly tree: TreeProjector;
	private foregroundGeneration: number;
	private foregroundObservedRunning: boolean;
	private sharing = false;
	private resetChatOnInvalidation = false;
	private disposal: Promise<void> | undefined;
	private initialCatalogLoad: Promise<void> | undefined;
	private lastForcedModelRefreshAt: number | undefined;
	private readonly dependencies: RuntimeControllerDependencies;
	private readonly autoTitlesInFlight = new Set<string>();

	private constructor(
		private runtime: AgentSessionRuntime,
		private readonly state: AppStore,
		private readonly runtimeFactory: CreateAgentSessionRuntimeFactory,
		private readonly preparedSessions: Promise<PreparedSessionList>,
		private readonly activationOptions: RuntimeControllerActivationOptions,
	) {
		this.dependencies =
			activationOptions.dependencies ?? runtimeControllerDependencies;
		this.extensionUi = new ExtensionUiController(state);
		this.foregroundGeneration = this.backgroundSessions.allocateGeneration();
		this.foregroundObservedRunning = runtime.session.isStreaming;
		this.models = new ModelController(
			() => this.runtime,
			state,
			() => this.afterModelChange(),
		);
		this.llama = new LlamaController(
			() => this.runtime,
			state,
			() => this.syncModels(),
		);
		this.usage = new UsageController(() => this.runtime, state);
		this.tree = new TreeProjector(
			() => this.runtime,
			state,
			() => this.loadCurrentSessionMessages(),
			() => this.foregroundGeneration,
		);
		this.catalog = new SessionCatalog(state, {
			agentDir: this.dependencies.getAgentDir(),
			backgroundStatuses: () =>
				new Map(
					[...this.backgroundSessions.entries()].map(([path, session]) => [
						path,
						session.status,
					]),
				),
			watch: this.dependencies.watchSessionCatalog,
		});
		this.prompts = new PromptLifecycle((runtime) => {
			if (runtime === this.runtime) return this.state;
			for (const session of this.backgroundSessions.values()) {
				if (session.runtime === runtime) return session.state;
			}
		});
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

	static async prepare(
		state: AppStore,
		cwd = defaultWorkspacePath(),
		options: RuntimeControllerActivationOptions = {},
	): Promise<RuntimeController> {
		const dependencies = options.dependencies ?? runtimeControllerDependencies;
		const sessionsPromise = dependencies.prepareSessions();
		const createRuntime: CreateAgentSessionRuntimeFactory = async ({
			cwd,
			sessionManager,
			sessionStartEvent,
		}) => {
			const services = await sessionPerformance.measure(
				"runtimeServicesCreate",
				() =>
					createAgentSessionServices({
						cwd,
						resourceLoaderOptions: { extensionFactories },
					}),
			);
			configureAgentHttpProxy(
				services.modelRuntime,
				services.settingsManager.getGlobalSettings().httpProxy,
			);
			const availableModels = await withAgentHttpProxy(services.modelRuntime, () =>
				services.modelRuntime.getAvailable(),
			);
			const scopedModels = sessionPerformance.measureSync(
				"scopedModelResolution",
				() =>
					resolveScopedModels(
						services.settingsManager.getEnabledModels() ?? [],
						availableModels,
					),
			);
			const readIsOverridden = services.resourceLoader
				.getExtensions()
				.extensions.some((extension) => extension.tools.has("read"));
			const session = await sessionPerformance.measure("runtimeSessionCreate", () =>
				createAgentSessionFromServices({
					services,
					sessionManager,
					sessionStartEvent,
					scopedModels,
					customTools: readIsOverridden
						? undefined
						: [createBunReadToolDefinition(cwd)],
				}),
			);
			return {
				...session,
				services,
				diagnostics: services.diagnostics,
			};
		};

		const runtime = await dependencies.createRuntime(createRuntime, {
			cwd,
			agentDir: dependencies.getAgentDir(),
			sessionManager: dependencies.createSessionManager(cwd),
		});
		try {
			const host = new RuntimeController(
				runtime,
				state,
				createRuntime,
				sessionsPromise,
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
		this.initialCatalogLoad = this.loadInitialCatalog();
		this.catalog.activate();
	}

	async prompt(text: string, options: RuntimePromptOptions = {}): Promise<boolean> {
		const trimmed = text.trim();
		if (!trimmed) {
			return false;
		}
		if (trimmed === "/tree") {
			this.tree.open();
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

		if (trimmed === "/llama") {
			this.openLlama();
			return true;
		}

		if (trimmed === "/compact" || trimmed.startsWith("/compact ")) {
			const customInstructions = trimmed.startsWith("/compact ")
				? trimmed.slice(9).trim()
				: undefined;
			void this.compact(customInstructions);
			return true;
		}

		if (trimmed === "/share") {
			void this.share();
			return true;
		}

		if (trimmed === "/reload") {
			void this.reload();
			return true;
		}

		const runtime = this.runtime;
		if (runtime.session.isCompacting) {
			this.prompts.queueAfterCompaction(
				runtime,
				trimmed,
				options.streamingBehavior ?? "steer",
				options.images,
			);
			return true;
		}

		return await this.prompts.submit(runtime, trimmed, options);
	}

	async abort(): Promise<void> {
		this.tree.cancelNavigation();
		await this.runtime.session.abort();
		this.prompts.clear(this.runtime);
		this.foregroundObservedRunning = false;
		this.state.setActivityText(undefined);
		this.state.setQueuedMessages([], []);
		this.loadCurrentSessionMessages();
		this.usage.sync();
		const path = this.runtime.session.sessionManager.getSessionFile();
		if (path) await this.catalog.refreshPath(path);
	}

	async abortBackgroundSession(sessionPath: string): Promise<boolean> {
		const session = this.backgroundSessions.get(sessionPath);
		if (session?.status !== "running") return false;
		await session.runtime.session.abort();
		session.status = "completed";
		session.observedRunning = false;
		this.catalog.mergeCurrentStatuses();
		await this.catalog.refreshPath(sessionPath);
		return true;
	}

	restoreQueuedMessages(): string {
		return this.prompts.restore(this.runtime);
	}

	async removeQueuedMessage(
		streamingBehavior: PromptStreamingBehavior,
		index: number,
	): Promise<boolean> {
		return await this.prompts.remove(this.runtime, streamingBehavior, index);
	}

	async newSession(): Promise<SessionTransitionResult> {
		return await this.transitionController.run(
			"New session",
			() => this.createNewSession(),
			{ overlay: false },
		);
	}

	private async createNewSession(): Promise<boolean> {
		const session = this.runtime.session;
		const persisted = session.sessionManager.isPersisted();
		const active = this.isCurrentRuntimeActive();
		if (active || !persisted) {
			const cwd = session.sessionManager.getCwd();
			await this.leaveCurrentRuntimeForReplacement();
			this.state.resetChat();
			const runtime = await this.dependencies.createRuntime(this.runtimeFactory, {
				cwd,
				agentDir: this.dependencies.getAgentDir(),
				sessionManager: this.dependencies.createSessionManager(cwd),
				sessionStartEvent: { type: "session_start", reason: "new" },
			});
			this.runtime = runtime;
			this.assignNewForegroundGeneration();
			this.bindRuntimeCallbacks(runtime);
		} else {
			this.resetChatOnInvalidation = true;
			let result: { cancelled: boolean };
			try {
				result = await this.runtime.newSession();
			} finally {
				this.resetChatOnInvalidation = false;
			}
			if (result.cancelled) {
				return false;
			}
			this.assignNewForegroundGeneration();
			// SDK in-place replacement overwrites lifecycle callbacks before returning.
			this.bindRuntimeCallbacks(this.runtime);
		}
		await this.bindSession({ refreshSessions: true });
		return true;
	}

	async newTemporarySession(): Promise<SessionTransitionResult> {
		return await this.transitionController.run(
			"New temporary session",
			() => this.createNewTemporarySession(),
			{ overlay: false },
		);
	}

	private async createNewTemporarySession(): Promise<boolean> {
		const previousSessionFile = this.runtime.session.sessionManager.getSessionFile();
		const cwd = this.runtime.session.sessionManager.getCwd();
		await this.leaveCurrentRuntimeForReplacement();

		this.state.resetChat();
		const runtime = await this.dependencies.createRuntime(this.runtimeFactory, {
			cwd,
			agentDir: this.dependencies.getAgentDir(),
			sessionManager: this.dependencies.createMemorySessionManager(cwd),
			sessionStartEvent: {
				type: "session_start",
				reason: "new",
				previousSessionFile,
			},
		});
		this.runtime = runtime;
		this.assignNewForegroundGeneration();
		this.bindRuntimeCallbacks(runtime);
		await this.bindSession();
		return true;
	}

	async listSessions(): Promise<void> {
		await this.initialCatalogLoad;
		this.usage.sync();
	}

	async renameSession(sessionPath: string, name: string): Promise<boolean> {
		const nextName = name.replace(/[\r\n]+/g, " ").trim();
		if (!nextName) return false;
		try {
			const manager = this.dependencies.openSessionManager(sessionPath);
			const target = manager.getSessionFile();
			if (!target) return false;
			const current = this.runtime.session;
			if (current.sessionManager.getSessionFile() === target) {
				current.setSessionName(nextName);
			} else {
				const background = this.backgroundSessions.get(target);
				if (background) background.runtime.session.setSessionName(nextName);
				else manager.appendSessionInfo(nextName);
			}
			await this.catalog.refreshPath(target);
			return true;
		} catch (error) {
			this.state.appendMessage(
				"system",
				`Failed to rename session: ${errorMessage(error)}`,
			);
			return false;
		}
	}

	async deleteSession(sessionPath: string): Promise<boolean> {
		const targetSessionFile = this.dependencies
			.openSessionManager(sessionPath)
			.getSessionFile();
		if (!targetSessionFile) {
			return false;
		}
		const deletingCurrent =
			targetSessionFile === this.runtime.session.sessionManager.getSessionFile();
		if (deletingCurrent && this.isCurrentRuntimeActive()) {
			this.state.appendMessage(
				"system",
				"Cannot delete the current session while it is running.",
			);
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
			if (deletingCurrent) {
				const replacement = await this.transitionController.run(
					"Delete current session",
					() => this.createNewSession(),
				);
				if (replacement.status !== "success") return false;
			}
			await this.dependencies.moveToTrash(targetSessionFile);
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
				`Failed to delete session: ${errorMessage(error)}`,
			);
			return false;
		}
	}

	getWorkspacePath(): string {
		return this.runtime.session.sessionManager.getCwd();
	}

	async openWorkspace(cwd: string): Promise<boolean> {
		if (cwd === this.getWorkspacePath()) return true;

		const replacement = await this.dependencies.createRuntime(this.runtimeFactory, {
			cwd,
			agentDir: this.dependencies.getAgentDir(),
			sessionManager: this.dependencies.createSessionManager(cwd),
		});
		try {
			await replacement.session.bindExtensions({
				mode: "rpc",
				uiContext: this.extensionUi.context(() => replacement === this.runtime),
			});
		} catch (error) {
			await replacement.dispose();
			throw error;
		}

		const previous = this.runtime;
		const action = this.currentRuntimeLeaveAction();
		if (action === "background") {
			this.backgroundCurrentRuntime();
		} else if (action === "discard") {
			await this.discardTemporaryRuntime();
		} else {
			this.unbindSession();
			try {
				await previous.dispose();
			} catch (error) {
				console.error("Failed to dispose previous workspace runtime", error);
			}
		}

		this.runtime = replacement;
		this.assignNewForegroundGeneration();
		this.bindRuntimeCallbacks(replacement);
		this.state.resetChat({ preserveEmptyHint: true });
		this.bindSessionState();
		return true;
	}

	async forkSessionToWorkspace(cwd: string): Promise<SessionTransitionResult> {
		const sourcePath = this.runtime.session.sessionManager.getSessionFile();
		if (!sourcePath) {
			this.state.appendMessage(
				"notice",
				"Temporary sessions cannot be forked to another workspace.",
			);
			return { status: "cancelled" };
		}

		return await this.transitionController.run(
			`Fork to ${formatHomePath(cwd)}`,
			async () => {
				const targetPath = this.dependencies
					.forkSessionManager(sourcePath, cwd)
					.getSessionFile();
				return targetPath
					? await this.resumeSessionTransition(targetPath)
					: false;
			},
			{ overlay: false },
		);
	}

	async resumeSession(sessionPath: string): Promise<SessionTransitionResult> {
		if (sessionPath === this.runtime.session.sessionManager.getSessionFile()) {
			return { status: "success" };
		}
		return await this.transitionController.run(
			sessionPath,
			async (generation) => {
				const transitionId =
					sessionPerformance.startSessionTransition(generation);
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
			},
			{ overlay: false },
		);
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
					() => this.dependencies.openSessionManager(path),
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
						this.dependencies.createRuntime(this.runtimeFactory, {
							cwd: sessionManager.getCwd(),
							agentDir: this.dependencies.getAgentDir(),
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
	): Promise<TreeNavigationResult> {
		return await this.tree.navigate(entryId, options);
	}

	async setThinkingLevel(level: string): Promise<boolean> {
		return this.models.setThinking(level);
	}

	cycleThinkingLevel(direction: "forward" | "backward" = "forward"): boolean {
		return this.models.cycleThinking(direction);
	}

	toggleThinkingBlockVisibility(): boolean {
		const settings = this.runtime.session.settingsManager;
		if (!settings) return false;
		const hidden = !settings.getHideThinkingBlock();
		settings.setHideThinkingBlock(hidden);
		this.state.setThinkingHidden(hidden);
		return true;
	}

	async compact(customInstructions?: string): Promise<boolean> {
		try {
			await this.runtime.session.compact(customInstructions);
			this.loadCurrentSessionMessages();
			return true;
		} catch {
			// AgentSession emits compaction_end with the user-facing error.
			return false;
		}
	}

	async reload(): Promise<boolean> {
		const runtime = this.runtime;
		const session = runtime.session;
		if (session.isStreaming) {
			this.state.appendMessage(
				"notice",
				"Wait for the current response to finish before reloading.",
			);
			return false;
		}
		if (session.isCompacting) {
			this.state.appendMessage(
				"notice",
				"Wait for compaction to finish before reloading.",
			);
			return false;
		}

		this.state.setActivityText("Reloading...");
		try {
			await session.reload();
			if (runtime !== this.runtime) return false;
			this.unbindSession();
			this.bindSessionState();
			this.loadCurrentSessionMessages();
			this.state.appendMessage(
				"system",
				"Reloaded extensions, skills, prompts, and context files.",
			);
			return true;
		} catch (error) {
			if (runtime === this.runtime) {
				this.state.appendMessage(
					"notice",
					`Reload failed: ${errorMessage(error)}`,
				);
			}
			return false;
		} finally {
			if (runtime === this.runtime) {
				this.state.setActivityText(undefined);
			}
		}
	}

	private async share(): Promise<void> {
		if (this.sharing) {
			this.state.appendMessage("notice", "A session share is already in progress.");
			return;
		}
		this.sharing = true;
		const generation = this.foregroundGeneration;
		this.state.setActivityText("Creating share...");
		try {
			const result = await this.dependencies.shareSession(this.runtime.session);
			if (generation !== this.foregroundGeneration) return;
			this.state.appendMessage(
				"system",
				`Share URL: ${result.shareUrl}\nGist: ${result.gistUrl}`,
			);
		} catch (error) {
			if (generation === this.foregroundGeneration) {
				this.state.appendMessage(
					"notice",
					`Failed to share session: ${errorMessage(error)}`,
				);
			}
		} finally {
			this.sharing = false;
			if (generation === this.foregroundGeneration) {
				this.state.setActivityText(undefined);
			}
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

	openLlama(): void {
		this.llama.open();
	}

	toggleLlamaModel(modelId: string): boolean {
		return this.llama.toggle(modelId);
	}

	closeLlama(): void {
		this.llama.close();
	}

	respondExtensionUi(
		requestId: string,
		response: string | undefined,
		cancelled: boolean,
	): boolean {
		return this.extensionUi.respond(requestId, response, cancelled);
	}

	async refreshModels(signal?: AbortSignal): Promise<void> {
		const now = Date.now();
		const force =
			this.lastForcedModelRefreshAt === undefined ||
			now - this.lastForcedModelRefreshAt >= modelCatalogForceIntervalMs;
		if (force) this.lastForcedModelRefreshAt = now;
		await this.models.refresh({ force, signal });
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

	dispose(): Promise<void> {
		this.disposal ??= this.disposeOwnedRuntimes();
		return this.disposal;
	}

	private async disposeOwnedRuntimes(): Promise<void> {
		this.extensionUi.cancelAll();
		this.unsubscribe?.();
		this.unsubscribe = undefined;
		this.catalog.dispose();
		this.auth.dispose();
		this.llama.dispose();
		this.usage.dispose();
		const runtimes = [this.runtime];
		for (const session of this.backgroundSessions.values()) {
			this.unsubscribeBackgroundSession(session);
			runtimes.push(session.runtime);
		}
		this.backgroundSessions.clear();
		this.prompts.dispose();

		const results = await Promise.allSettled(
			runtimes.map((runtime) => Promise.resolve().then(() => runtime.dispose())),
		);
		const errors = results.flatMap((result) =>
			result.status === "rejected" ? [result.reason] : [],
		);
		if (errors.length > 0) {
			throw new AggregateError(errors, "Failed to dispose owned runtimes");
		}
	}

	private isCurrentRuntimeActive(): boolean {
		return (
			this.runtime.session.isStreaming ||
			this.runtime.session.isCompacting ||
			this.foregroundObservedRunning ||
			this.prompts.hasPending(this.runtime)
		);
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
		const unsubscribe = session.unsubscribe;
		session.unsubscribe = () => {};
		unsubscribe();
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
			if (!ownsForeground()) return;
			this.unbindSession();
			if (this.resetChatOnInvalidation) this.state.resetChat();
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

	private async leaveCurrentRuntimeForReplacement(): Promise<void> {
		if (!this.isCurrentRuntimeActive()) {
			this.unbindSession();
			await this.runtime.dispose();
			return;
		}
		if (this.runtime.session.sessionManager.isPersisted()) {
			this.backgroundCurrentRuntime();
			return;
		}
		await this.discardTemporaryRuntime();
	}

	private async discardTemporaryRuntime(): Promise<void> {
		const runtime = this.runtime;
		this.prompts.clear(runtime);
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
					`Failed to abort temporary session: ${errorMessage(error)}`,
				);
			},
		});
		this.state.setActivityText(undefined);
		this.state.setQueuedMessages([], []);
		clearSessionEventToolState(this.tools);
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
			tools: cloneSessionEventToolState(this.tools),
			unsubscribe: () => {},
		};
		backgroundSession.unsubscribe = this.runtime.session.subscribe((event) =>
			this.handleBackgroundEvent(backgroundSession, event),
		);
		this.backgroundSessions.register(sessionFile, backgroundSession);
		this.state.setCurrentSessionPath(undefined);
		this.catalog.mergeCurrentStatuses();
		void this.catalog.refreshPath(sessionFile);
	}

	private handleBackgroundEvent(
		backgroundSession: BackgroundSession,
		event: AgentSessionEvent,
	): void {
		if (event.type === "agent_start") backgroundSession.observedRunning = true;
		if (event.type === "agent_settled") backgroundSession.observedRunning = false;
		const outcome = this.reduceEvent(
			event,
			backgroundSession.state,
			backgroundSession.tools,
		);
		this.updateSessionCatalogFromEvent(event, backgroundSession.runtime);
		this.scheduleAutoTitleAfterUserMessage(backgroundSession.runtime, event);
		if (event.type === "queue_update") {
			this.prompts.sync(backgroundSession.runtime);
		}
		if (event.type === "compaction_end") {
			void this.prompts.flushCompactionQueue(backgroundSession.runtime);
		}
		if (outcome.agentCompleted) {
			this.unsubscribeBackgroundSession(backgroundSession);
			backgroundSession.status = "completed";
			this.catalog.mergeCurrentStatuses();
			this.notifyRuntimeDone(backgroundSession.runtime, true);
			const path =
				backgroundSession.runtime.session.sessionManager.getSessionFile();
			if (path) {
				this.catalog.agentCompleted(path);
				void this.catalog.refreshPath(path);
			}
			return;
		}
	}

	private notifyRuntimeDone(runtime: AgentSessionRuntime, background: boolean): void {
		void this.notifyRuntimeDoneWhenAppropriate(
			{
				workspace: formatHomePath(runtime.session.sessionManager.getCwd()),
				sessionPath: runtime.session.sessionManager.getSessionFile(),
			},
			background,
		);
	}

	private async notifyRuntimeDoneWhenAppropriate(
		details: SessionDoneNotification,
		background: boolean,
	): Promise<void> {
		if (
			!background &&
			(await (this.activationOptions.isApplicationFocused?.() ?? true))
		) {
			return;
		}
		const notify =
			this.activationOptions.notifySessionDone ??
			this.dependencies.notifySessionDone;
		await notify(details);
	}

	private async activateRuntime(backgroundSession: BackgroundSession): Promise<void> {
		await this.leaveCurrentRuntimeForReplacement();
		this.unsubscribeBackgroundSession(backgroundSession);
		this.runtime = backgroundSession.runtime;
		this.foregroundGeneration = backgroundSession.generation;
		this.foregroundObservedRunning = backgroundSession.observedRunning;
		restoreSessionEventToolState(this.tools, backgroundSession.tools);
		this.bindRuntimeCallbacks(this.runtime);
		this.bindSessionState({ resetToolState: false, syncSessions: false });
		this.state.restoreChat(backgroundSession.state.snapshot());
		this.catalog.mergeCurrentStatuses();
	}

	private async bindSession(
		options: { refreshSessions?: boolean } = {},
	): Promise<void> {
		this.unbindSession();
		await this.bindSessionExtensions();
		this.bindSessionState(options);
	}

	private unbindSession(): void {
		this.extensionUi.cancelAll();
		this.unsubscribe?.();
		this.unsubscribe = undefined;
		this.usage.suspend();
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
			if (resetToolState) clearSessionEventToolState(this.tools);
			this.unsubscribe = session.subscribe((event) => this.handleEvent(event));
			this.state.setActivityText(
				session.isStreaming || this.foregroundObservedRunning
					? "Working..."
					: undefined,
			);
			this.syncModels();
			this.models.syncThinking();
			this.state.setThinkingHidden(
				session.settingsManager?.getHideThinkingBlock() ?? false,
			);
			this.syncSlashCommands();
			this.usage.sync();
			this.usage.refresh(true);
			if (options.syncSessions !== false) {
				this.catalog.mergeCurrentStatuses();
			}
			if (options.refreshSessions === true) {
				void this.refreshSessions();
			}
		});
	}

	private async bindSessionExtensions(): Promise<void> {
		const runtime = this.runtime;
		const generation = this.foregroundGeneration;
		const session = runtime.session;
		await sessionPerformance.measure("extensionBind", () =>
			session.bindExtensions({
				mode: "rpc",
				uiContext: this.extensionUi.context(
					() =>
						runtime === this.runtime &&
						generation === this.foregroundGeneration,
				),
				commandContextActions: {
					waitForIdle: () => session.waitForIdle(),
					newSession: (options) => runtime.newSession(options),
					fork: async (entryId, options) => {
						const result = await runtime.fork(entryId, options);
						return { cancelled: result.cancelled };
					},
					navigateTree: async (targetId, options) => {
						const result = await session.navigateTree(targetId, options);
						if (!result.cancelled && runtime === this.runtime) {
							this.loadCurrentSessionMessages();
						}
						return { cancelled: result.cancelled };
					},
					switchSession: (sessionPath, options) =>
						runtime.switchSession(sessionPath, options),
					reload: async () => {
						await this.reload();
					},
				},
			}),
		);
	}

	private async loadInitialCatalog(): Promise<void> {
		await this.catalog.refresh(() => this.preparedSessions, {
			refreshWorkspaces: this.activationOptions.refreshWorkspaces,
		});
	}

	private async refreshSessions(): Promise<void> {
		await this.initialCatalogLoad;
		await this.catalog.refresh(this.dependencies.refreshSessions, {
			showLoading: false,
		});
	}

	private updateSessionCatalogFromEvent(
		event: AgentSessionEvent,
		runtime: AgentSessionRuntime,
	): void {
		const manager = runtime.session.sessionManager;
		const path = manager.getSessionFile();
		if (path) this.catalog.handleEvent(path, event, manager.getCwd());
	}

	private afterModelChange(): void {
		this.usage.suspend();
		this.models.sync();
		this.models.syncThinking();
		this.usage.sync();
		this.usage.refresh(true);
	}

	private syncModels(): void {
		this.models.sync();
	}

	private handleEvent(event: AgentSessionEvent): void {
		if (event.type === "agent_start") this.foregroundObservedRunning = true;
		if (event.type === "agent_settled") this.foregroundObservedRunning = false;
		this.state.update(
			() => {
				const outcome = this.reduceEvent(event, this.state, this.tools, () =>
					this.usage.sync(),
				);
				this.updateSessionCatalogFromEvent(event, this.runtime);
				this.scheduleAutoTitleAfterUserMessage(this.runtime, event);
				if (this.foregroundObservedRunning && !this.state.activityText) {
					this.state.setActivityText("Working...");
				}
				if (outcome.agentCompleted) {
					const path = this.runtime.session.sessionManager.getSessionFile();
					if (path) this.catalog.agentCompleted(path);
					this.usage.sync();
					this.usage.refresh(true);
					this.notifyRuntimeDone(this.runtime, false);
					if (path) void this.catalog.refreshPath(path);
				}
			},
			// Streaming deltas use the documented targeted-message patch path.
			{ commit: false },
		);
		if (event.type === "queue_update") {
			this.prompts.sync(this.runtime);
		}
		if (event.type === "compaction_end") {
			void this.prompts.flushCompactionQueue(this.runtime);
		}
	}

	private scheduleAutoTitleAfterUserMessage(
		runtime: AgentSessionRuntime,
		event: AgentSessionEvent,
	): void {
		if (event.type !== "message_end" || event.message.role !== "user") return;
		// Pi persists message_end after notifying subscribers.
		queueMicrotask(() => this.maybeGenerateAutoTitle(runtime));
	}

	private maybeGenerateAutoTitle(runtime: AgentSessionRuntime): void {
		const config = this.activationOptions.autoTitle;
		const path = runtime.session.sessionManager.getSessionFile();
		if (
			!config?.enabled ||
			!path ||
			runtime.session.sessionManager.getSessionName() ||
			this.autoTitlesInFlight.has(path)
		) {
			return;
		}
		this.autoTitlesInFlight.add(path);
		void generateAutoTitle(runtime, config)
			.then((title) => {
				if (!title || runtime.session.sessionManager.getSessionName()) return;
				runtime.session.setSessionName(title);
				this.catalog.rename(path, title);
			})
			.catch((error: ErrorOptions["cause"]) =>
				console.warn("Failed to generate session title", error),
			)
			.finally(() => this.autoTitlesInFlight.delete(path));
	}

	private reduceEvent(
		event: AgentSessionEvent,
		state: SessionEventStateSink,
		tools: SessionEventToolState,
		syncUsage?: () => void,
	) {
		return reduceSessionEvent(event, {
			state,
			tools,
			convertMessage: (message, timestamp) =>
				this.transcript.message(message, timestamp, {
					includeAssistantError: false,
				}),
			formatToolStart: (toolEvent) =>
				this.formatRunningTool(toolEvent.toolName, toolEvent.args),
			formatToolPreview: (toolName, args) =>
				this.formatRunningTool(toolName, args, false),
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
			cacheMissNotice: (message) => {
				if (!this.runtime.session.settingsManager?.getShowCacheMissNotices()) {
					return undefined;
				}
				const miss = detectCacheMiss(
					this.runtime.session.sessionManager.getEntries(),
					message,
					this.runtime.session.modelRuntime,
				);
				return miss ? formatCacheMissNotice(miss) : undefined;
			},
			syncUsage,
		});
	}

	private formatRunningTool(toolName: string, args: ToolArguments, showBody = true) {
		const view = formatToolStart(toolName, args);
		return {
			text: showBody ? view.text : "",
			options: {
				title: toolTitle("running", toolName, args),
				titleParts: toolTitleParts(toolName, args),
				meta: toolMeta(toolName, args),
				state: "running" as const,
				format: view.format,
			},
		};
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
				name: "llama",
				description: "Load or unload llama.cpp models",
				source: "system" as const,
			},
			{
				name: "compact",
				description: "Manually compact the session context",
				source: "system" as const,
				argumentHint: "[instructions]",
			},
			{
				name: "share",
				description: "Share session as a secret GitHub gist",
				source: "system" as const,
			},
			{
				name: "reload",
				description: "Reload extensions, skills, prompts, and context files",
				source: "system" as const,
			},
			...prompts,
			...skills,
		]);
	}

	private loadCurrentSessionMessages(): void {
		this.transcript.load(this.runtime, this.state);
		this.usage.sync();
	}
}
