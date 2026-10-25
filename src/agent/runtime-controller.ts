import { realpath } from "node:fs/promises";
import { sep } from "node:path";

import {
	type AgentSessionEvent,
	type AgentSessionRuntime,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	type CreateAgentSessionRuntimeFactory,
	createAgentSessionServices,
	createCodemodeExtension,
	createMcpExtension,
	createToolSearchExtension,
	getAgentDir,
	resolveModelScopeWithDiagnostics,
	SessionManager,
	type SessionStartEvent,
} from "@earendil-works/pi-coding-agent";

import { AuthController } from "#src/agent/auth-controller.ts";
import { type AutoTitleConfig, generateAutoTitle } from "#src/agent/auto-title.ts";
import {
	BackgroundRuntimeOwnership,
	ownsForegroundGeneration,
	RuntimeOwnershipInvariantError,
} from "#src/agent/background-runtime-ownership.ts";
import { detectCacheMiss, formatCacheMissNotice } from "#src/agent/cache-miss.ts";
import { ExtensionUiController } from "#src/agent/extension-ui-controller.ts";
import { LlamaController } from "#src/agent/llama-controller.ts";
import { llamaProviderExtension } from "#src/agent/llama-provider-extension.ts";
import { mermaidExtension } from "#src/agent/mermaid-extension.ts";
import { ModelController } from "#src/agent/model-controller.ts";
import "#src/agent/codemode-assets.ts";
import { resolvePath } from "#pi/utils/paths.js";
import {
	PromptLifecycle,
	type PromptStreamingBehavior,
	type RuntimePromptOptions,
} from "#src/agent/prompt-lifecycle.ts";
import { createBunReadToolDefinition } from "#src/agent/read-tool.ts";
import {
	type SessionCatalogWatch,
	watchSessionCatalog,
} from "#src/agent/session-catalog-watcher.ts";
import { type PreparedSessionList, SessionCatalog } from "#src/agent/session-catalog.ts";
import { resolveSessionDir, sessionDirOverride } from "#src/agent/session-dir.ts";
import {
	clearSessionEventToolState,
	cloneSessionEventToolState,
	createSessionEventToolState,
	reduceSessionEvent,
	restoreSessionEventToolState,
	type SessionEventStateSink,
	type SessionEventToolState,
	type ToolArguments,
} from "#src/agent/session-event-reducer.ts";
import { shareSession } from "#src/agent/session-share.ts";
import {
	SessionTransitionController,
	type SessionTransitionResult,
} from "#src/agent/session-transition-controller.ts";
import {
	formatToolResult,
	formatToolStart,
	toolEndMeta,
	toolMeta,
	toolResultImageAttachments,
	toolTitle,
	toolTitleParts,
} from "#src/agent/tool-presentation.ts";
import { TranscriptProjector } from "#src/agent/transcript-projector.ts";
import { type TreeNavigationResult, TreeProjector } from "#src/agent/tree-projector.ts";
import { UsageController } from "#src/agent/usage-controller.ts";
import type { SessionDoneNotification } from "#src/browser-notifications.ts";
import { sessionPerformance } from "#src/perf/session-performance.ts";
import {
	type AppSlashCommand,
	AppStore,
	type BackgroundSessionStatus,
} from "#src/state/app-store.ts";
import { TranscriptState } from "#src/state/transcript-state.ts";
import { errorMessage } from "#src/utils/errors.ts";
import { configureAgentHttpProxy, withAgentHttpProxy } from "#src/utils/http-proxy.ts";
import { moveToTrash } from "#src/utils/trash.ts";
import {
	defaultWorkspacePath,
	formatHomePath,
	managedWorktreeParts,
	workspaceDisplayName,
} from "#src/utils/workspace.ts";

const extensionFactories = [
	llamaProviderExtension,
	mermaidExtension,
	{
		name: "codemode",
		factory: createCodemodeExtension(),
		builtin: true,
		replaceable: true,
	},
	{
		name: "tool-search",
		factory: createToolSearchExtension(),
		builtin: true,
		replaceable: true,
	},
	{ name: "mcp", factory: createMcpExtension(), builtin: true, replaceable: true },
];
const modelCatalogForceIntervalMs = 30 * 60 * 1000;
const systemSlashCommands = [
	{
		name: "login",
		description: "Log in with a subscription or API key",
		source: "system",
		argumentHint: "[provider]",
	},
	{
		name: "logout",
		description: "Remove stored provider credentials",
		source: "system",
	},
	{
		name: "tree",
		description: "Navigate and branch within the current session",
		source: "system",
	},
	{
		name: "llama",
		description: "Load or unload llama.cpp models",
		source: "system",
	},
	{
		name: "compact",
		description: "Manually compact the session context",
		source: "system",
		argumentHint: "[instructions]",
	},
	{
		name: "share",
		description: "Share session as a secret GitHub gist",
		source: "system",
	},
	{
		name: "reload",
		description: "Reload extensions, skills, prompts, and context files",
		source: "system",
	},
] satisfies readonly AppSlashCommand[];
const systemSlashCommandNames = new Set(
	systemSlashCommands.map((command) => command.name),
);

type BackgroundSession = {
	runtime: AgentSessionRuntime;
	state: TranscriptState;
	status: BackgroundSessionStatus;
	generation: number;
	observedRunning: boolean;
	tools: SessionEventToolState;
	unsubscribe: () => void;
	activating: boolean;
};

export type RuntimeControllerDependencies = Readonly<{
	createRuntime: typeof createAgentSessionRuntime;
	prepareSessions: typeof SessionCatalog.prepare;
	createSessionManager: typeof SessionManager.create;
	createMemorySessionManager: typeof SessionManager.inMemory;
	forkSessionManager: typeof SessionManager.forkFrom;
	openSessionManager: typeof SessionManager.open;
	moveToTrash: typeof moveToTrash;
	shareSession: typeof shareSession;
	getAgentDir: typeof getAgentDir;
	watchSessionCatalog?: SessionCatalogWatch;
}>;

const runtimeControllerDependencies: RuntimeControllerDependencies = {
	createRuntime: createAgentSessionRuntime,
	prepareSessions: SessionCatalog.prepare,
	createSessionManager: SessionManager.create,
	createMemorySessionManager: SessionManager.inMemory,
	forkSessionManager: SessionManager.forkFrom,
	openSessionManager: SessionManager.open,
	moveToTrash,
	shareSession,
	getAgentDir,
	watchSessionCatalog,
};

export type RuntimeControllerActivationOptions = {
	refreshWorkspaces?: boolean;
	transitionController?: SessionTransitionController;
	dependencies?: RuntimeControllerDependencies;
	notifySessionDone?: (details: SessionDoneNotification) => void;
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
	private readonly completedBackgroundPaths = new Set<string>();
	private readonly catalog: SessionCatalog;
	private readonly llama: LlamaController;
	private readonly models: ModelController;
	private readonly usage: UsageController;
	private readonly extensionUi: ExtensionUiController;
	private readonly transcript = new TranscriptProjector();
	private projectedSessionId: string | undefined;
	private readonly tree: TreeProjector;
	private foregroundGeneration: number;
	private foregroundObservedRunning: boolean;
	private sharing = false;
	private resetChatOnInvalidation = false;
	private disposal: Promise<void> | undefined;
	private initialCatalogLoad: Promise<void> | undefined;
	private lastForcedModelRefreshAt: number | undefined;
	private readonly dependencies: RuntimeControllerDependencies;
	private readonly sessionDir: string | undefined;
	private readonly autoTitlesInFlight = new Set<string>();

	private constructor(
		private runtime: AgentSessionRuntime,
		private readonly state: AppStore,
		private readonly runtimeFactory: CreateAgentSessionRuntimeFactory,
		private readonly preparedSessions: Promise<PreparedSessionList>,
		sessionDir: string | undefined,
		private readonly activationOptions: RuntimeControllerActivationOptions,
	) {
		this.dependencies =
			activationOptions.dependencies ?? runtimeControllerDependencies;
		this.sessionDir = sessionDir;
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
			() => this.models.sync(),
		);
		this.usage = new UsageController(() => this.runtime, state);
		this.tree = new TreeProjector(
			() => this.runtime,
			state,
			() => this.loadCurrentSessionMessages(),
			() => this.foregroundGeneration,
		);
		this.catalog = new SessionCatalog(state, {
			sessionDir: resolveSessionDir(this.dependencies.getAgentDir()),
			backgroundStatuses: () => this.backgroundStatuses(),
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

	static async create(
		state: AppStore,
		cwd = defaultWorkspacePath(),
		options: RuntimeControllerActivationOptions = {},
	): Promise<RuntimeController> {
		const controller = await RuntimeController.prepare(state, cwd, options);
		controller.activate();
		return controller;
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
			// pi-ui resizes images with Bun.Image because pi's Photon resizer is not
			// bundled in compiled builds. Force pi's image auto-resize off for this
			// manager (an override on the method, not the setting, so it survives
			// settings saves) to avoid dropping prompt images when Photon is absent.
			services.settingsManager.getImageAutoResize = () => false;
			configureAgentHttpProxy(
				services.modelRuntime,
				services.settingsManager.getGlobalSettings().httpProxy,
			);
			const { scopedModels } = await sessionPerformance.measure(
				"scopedModelResolution",
				() =>
					withAgentHttpProxy(services.modelRuntime, () =>
						resolveModelScopeWithDiagnostics(
							services.settingsManager.getEnabledModels() ?? [],
							services.modelRuntime,
						),
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

		const sessionDir = sessionDirOverride();
		const runtime = await dependencies.createRuntime(createRuntime, {
			cwd,
			agentDir: dependencies.getAgentDir(),
			sessionManager: dependencies.createSessionManager(cwd, sessionDir),
		});
		try {
			const host = new RuntimeController(
				runtime,
				state,
				createRuntime,
				sessionsPromise,
				sessionDir,
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
			this.openTree();
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
		const queued = this.prompts.restore(this.runtime);
		const draft = this.state.promptEditorText;
		this.foregroundObservedRunning = false;
		this.state.setActivityText(undefined);
		this.state.setQueuedMessages([], []);
		// Session events already finalized messages; reloading would discard highlighting.
		this.usage.sync();
		const path = this.runtime.session.sessionManager.getSessionFile();
		if (path) await this.catalog.refreshPath(path);
		if (queued) {
			this.state.setPromptEditorText(
				[queued, draft].filter((text) => text.trim()).join("\n\n"),
			);
		}
	}

	async abortBackgroundSession(sessionPath: string): Promise<boolean> {
		const session = this.backgroundSessions.get(sessionPath);
		if (session?.status !== "running") return false;
		await session.runtime.session.abort();
		session.status = "completed";
		session.observedRunning = false;
		this.catalog.mergeCurrentStatuses();
		await this.catalog.refreshPath(sessionPath);
		this.releaseBackgroundSession(session);
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
			await this.replaceRuntime(
				cwd,
				this.dependencies.createSessionManager(cwd, this.sessionDir),
				{ type: "session_start", reason: "new" },
			);
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
			// SDK in-place replacement overwrites lifecycle callbacks before returning.
			this.adoptRuntime(this.runtime);
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
		await this.replaceRuntime(
			cwd,
			this.dependencies.createMemorySessionManager(cwd),
			{
				type: "session_start",
				reason: "new",
				previousSessionFile,
			},
		);
		await this.bindSession();
		return true;
	}

	private async replaceRuntime(
		cwd: string,
		sessionManager: SessionManager,
		sessionStartEvent: SessionStartEvent,
	): Promise<void> {
		await this.leaveCurrentRuntimeForReplacement();
		this.state.resetChat();
		const runtime = await this.dependencies.createRuntime(this.runtimeFactory, {
			cwd,
			agentDir: this.dependencies.getAgentDir(),
			sessionManager,
			sessionStartEvent,
		});
		this.adoptRuntime(runtime);
	}

	async listSessions(): Promise<void> {
		await this.initialCatalogLoad;
		this.usage.sync();
	}

	async renameSession(sessionPath: string, name: string): Promise<boolean> {
		const nextName = name.replace(/[\r\n]+/g, " ").trim();
		if (!nextName) return false;
		try {
			const manager = this.dependencies.openSessionManager(
				sessionPath,
				this.sessionDir,
			);
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
			.openSessionManager(sessionPath, this.sessionDir)
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
			if (this.state.previousSessionPath === targetSessionFile) {
				this.state.setPreviousSessionPath(undefined);
			}
			const backgroundSession = this.backgroundSessions.get(targetSessionFile);
			if (backgroundSession) {
				this.unsubscribeBackgroundSession(backgroundSession);
				await backgroundSession.runtime.dispose();
				this.backgroundSessions.delete(targetSessionFile);
				this.completedBackgroundPaths.delete(targetSessionFile);
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

	async hasRunningSessionInWorktree(path: string): Promise<boolean> {
		const runningCwds: string[] = [];
		if (this.isCurrentRuntimeActive()) runningCwds.push(this.getWorkspacePath());
		for (const session of this.backgroundSessions.values()) {
			if (session.status === "running")
				runningCwds.push(session.runtime.session.sessionManager.getCwd());
		}
		for (const cwd of runningCwds) {
			const resolved = await realpath(cwd).catch(() => cwd);
			if (resolved === path || resolved.startsWith(`${path}${sep}`)) return true;
		}
		return false;
	}

	async openWorkspace(cwd: string): Promise<boolean> {
		if (cwd === this.getWorkspacePath()) return true;

		const replacement = await this.dependencies.createRuntime(this.runtimeFactory, {
			cwd,
			agentDir: this.dependencies.getAgentDir(),
			sessionManager: this.dependencies.createSessionManager(cwd, this.sessionDir),
		});
		try {
			await replacement.session.bindExtensions({
				mode: "rpc",
				uiContext: this.extensionUi.context(() => replacement === this.runtime),
				onError: (error) => {
					if (replacement === this.runtime) {
						this.state.appendMessage(
							"notice",
							`Extension ${error.extensionPath}: ${error.error}`,
						);
					}
				},
			});
		} catch (error) {
			await replacement.dispose();
			throw error;
		}

		const action = this.currentRuntimeLeaveAction();
		try {
			await this.leaveCurrentRuntimeForReplacement(action);
		} catch (error) {
			if (action !== "dispose") throw error;
			console.error("Failed to dispose previous workspace runtime", error);
		}

		this.adoptRuntime(replacement);
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
					.forkSessionManager(sourcePath, cwd, this.sessionDir)
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
		if (!sessionPath.trim()) return false;
		const sourcePersisted = this.runtime.session.sessionManager.isPersisted();
		sessionPerformance.recordOwnershipDiagnostics(
			{
				sourceGeneration: this.foregroundGeneration,
				sourceSdkStreaming: this.runtime.session.isStreaming,
				sourceObservedRunning: this.foregroundObservedRunning,
				sourcePersisted,
				sourceLocationBefore: "foreground",
				ownedLiveRuntimeCount: this.ownedLiveRuntimeCount(),
				duplicateKeyInvariantFailures:
					this.backgroundSessions.invariantFailureCount,
			},
			transitionId,
		);
		const canonicalPath = resolvePath(sessionPath);
		const background = this.backgroundSessions.get(canonicalPath);
		sessionPerformance.recordOwnershipDiagnostics(
			{
				targetBackgroundLookup: background ? "hit" : "miss",
				targetLocationBefore: background
					? background.status === "running"
						? "background-running"
						: "background-completed"
					: "disposed",
			},
			transitionId,
		);
		let resumed = true;
		if (background) {
			background.activating = true;
			const action = this.currentRuntimeLeaveAction();
			sessionPerformance.recordOwnershipDiagnostics(
				{ leaveAction: action },
				transitionId,
			);
			try {
				await sessionPerformance.measure(
					"backgroundActivation",
					() => this.activateRuntime(background),
					transitionId,
				);
				this.backgroundSessions.release(canonicalPath, background);
				sessionPerformance.recordOwnershipDiagnostics(
					{
						sourceLocationAfter: this.leaveActionLocation(action),
						targetLocationAfter: "foreground",
					},
					transitionId,
				);
			} catch (error) {
				if (background.status === "completed")
					this.releaseBackgroundSession(background);
				throw error;
			} finally {
				background.activating = false;
			}
		} else if (!this.isCurrentRuntimeActive() && sourcePersisted) {
			sessionPerformance.recordOwnershipDiagnostics(
				{ leaveAction: "dispose" },
				transitionId,
			);
			const result = await sessionPerformance.measure(
				"runtimeSwitchCreate",
				() => this.runtime.switchSession(sessionPath),
				transitionId,
			);
			resumed = !result.cancelled;
			if (resumed) {
				sessionPerformance.recordSessionOpen(transitionId);
				this.adoptRuntime(this.runtime);
				sessionPerformance.recordOwnershipDiagnostics(
					{
						sourceLocationAfter: "disposed",
						targetLocationAfter: "foreground",
					},
					transitionId,
				);
			}
		} else {
			// Parse the target before changing ownership of the outgoing runtime.
			const manager = sessionPerformance.measureSync(
				"sessionManagerOpen",
				() => this.dependencies.openSessionManager(sessionPath, this.sessionDir),
				transitionId,
			);
			sessionPerformance.recordSessionOpen(transitionId);
			const action = this.currentRuntimeLeaveAction();
			sessionPerformance.recordOwnershipDiagnostics(
				{ leaveAction: action },
				transitionId,
			);
			await this.leaveCurrentRuntimeForReplacement(action);
			const replacement = await sessionPerformance.measure(
				"runtimeSwitchCreate",
				() =>
					this.dependencies.createRuntime(this.runtimeFactory, {
						cwd: manager.getCwd(),
						agentDir: this.dependencies.getAgentDir(),
						sessionManager: manager,
					}),
				transitionId,
			);
			this.adoptRuntime(replacement);
			await sessionPerformance.measure(
				"runtimeRebind",
				() => this.bindSession(),
				transitionId,
			);
			// A new session must not inherit the outgoing session's history window.
			this.state.resetChat({ broadcast: false });
			this.loadCurrentSessionMessages();
			sessionPerformance.recordOwnershipDiagnostics(
				{
					sourceLocationAfter: this.leaveActionLocation(action),
					targetLocationAfter: "foreground",
				},
				transitionId,
			);
		}
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
		this.state.openTreeDialog();
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
		const runtime = this.runtime;
		const session = runtime.session;
		try {
			await session.compact(customInstructions);
			if (this.runtime === runtime && runtime.session === session)
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
			await session.reload({ beforeSessionStart: () => this.unbindSession() });
			if (runtime !== this.runtime) return false;
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
		this.completedBackgroundPaths.clear();
		this.prompts.dispose();

		const results = await Promise.allSettled(
			runtimes.map((runtime) => Promise.try(() => runtime.dispose())),
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

	private adoptRuntime(
		runtime: AgentSessionRuntime,
		ownership?: { generation: number; observedRunning: boolean },
	): void {
		this.runtime = runtime;
		this.foregroundGeneration =
			ownership?.generation ?? this.backgroundSessions.allocateGeneration();
		this.foregroundObservedRunning =
			ownership?.observedRunning ?? runtime.session.isStreaming;
		this.bindRuntimeCallbacks(runtime);
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

	/** Keeps the outgoing persisted session reachable for the alternate-session jump. */
	private rememberCurrentSession(): void {
		const path = this.runtime.session.sessionManager.getSessionFile();
		if (path) this.state.setPreviousSessionPath(path);
	}

	private async leaveCurrentRuntimeForReplacement(
		action = this.currentRuntimeLeaveAction(),
	): Promise<void> {
		this.rememberCurrentSession();
		if (action === "background") {
			this.backgroundCurrentRuntime();
		} else if (action === "discard") {
			await this.discardTemporaryRuntime();
		} else {
			this.unbindSession();
			const end = sessionPerformance.startSpan("runtimeDispose");
			try {
				await this.runtime.dispose();
			} finally {
				end();
			}
		}
	}

	private async discardTemporaryRuntime(): Promise<void> {
		const runtime = this.runtime;
		this.prompts.clear(runtime);
		this.unbindSession();
		try {
			await runtime.session.abort();
		} catch (error) {
			this.state.appendMessage(
				"system",
				`Failed to abort temporary session: ${errorMessage(error)}`,
			);
		}
		await runtime.dispose();
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
			activating: false,
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
			void this.prompts.flushCompactionQueue(backgroundSession.runtime).then(() => {
				const runtime = backgroundSession.runtime;
				const path = runtime.session.sessionManager.getSessionFile();
				if (
					event.reason !== "manual" ||
					!path ||
					this.backgroundSessions.get(path) !== backgroundSession ||
					runtime.session.isCompacting ||
					runtime.session.isStreaming ||
					backgroundSession.observedRunning ||
					this.prompts.hasPending(runtime)
				)
					return;
				this.completeBackgroundSession(backgroundSession);
			});
		}
		if (outcome.agentCompleted) this.completeBackgroundSession(backgroundSession);
	}

	private completeBackgroundSession(backgroundSession: BackgroundSession): void {
		if (backgroundSession.status === "completed") return;
		this.unsubscribeBackgroundSession(backgroundSession);
		backgroundSession.status = "completed";
		this.catalog.mergeCurrentStatuses();
		this.notifyRuntimeDone(backgroundSession.runtime);
		const path = backgroundSession.runtime.session.sessionManager.getSessionFile();
		if (path) {
			this.catalog.agentCompleted(path);
			void this.catalog.refreshPath(path);
		}
		this.releaseBackgroundSession(backgroundSession);
	}

	/**
	 * A finished background runtime is idle until the user returns to it, but it
	 * still holds its session branch in memory. Drop the runtime and transcript
	 * after the current event settles, keeping only the completed badge; a later
	 * resume rebuilds it from disk. Disposal waits for an in-flight activation.
	 */
	private releaseBackgroundSession(session: BackgroundSession): void {
		const path = session.runtime.session.sessionManager.getSessionFile();
		if (!path) return;
		queueMicrotask(() => {
			if (session.activating) return;
			if (this.backgroundSessions.get(path) !== session) return;
			this.backgroundSessions.delete(path);
			this.completedBackgroundPaths.add(path);
			this.catalog.mergeCurrentStatuses();
			void Promise.try(() => session.runtime.dispose()).catch(
				(error: ErrorOptions["cause"]) =>
					console.error("Failed to dispose background runtime", error),
			);
		});
	}

	private backgroundStatuses(): Map<string, BackgroundSessionStatus> {
		const statuses = new Map<string, BackgroundSessionStatus>(
			[...this.backgroundSessions.entries()].map(([path, session]) => [
				path,
				session.status,
			]),
		);
		for (const path of this.completedBackgroundPaths) {
			if (!statuses.has(path)) statuses.set(path, "completed");
		}
		return statuses;
	}

	private notifyRuntimeDone(runtime: AgentSessionRuntime): void {
		const cwd = runtime.session.sessionManager.getCwd();
		const worktree = managedWorktreeParts(cwd);
		this.activationOptions.notifySessionDone?.({
			workspace: worktree
				? `${worktree.project}/${worktree.branch}`
				: workspaceDisplayName(cwd),
			sessionPath: runtime.session.sessionManager.getSessionFile(),
		});
	}

	private async activateRuntime(backgroundSession: BackgroundSession): Promise<void> {
		await this.leaveCurrentRuntimeForReplacement();
		this.unsubscribeBackgroundSession(backgroundSession);
		this.adoptRuntime(backgroundSession.runtime, backgroundSession);
		restoreSessionEventToolState(this.tools, backgroundSession.tools);
		this.bindSessionState({ resetToolState: false, syncSessions: false });
		this.state.restoreChat(backgroundSession.state.snapshot());
		await this.bindSessionExtensions();
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
			const sessionFile = session.sessionManager.getSessionFile();
			this.state.setCurrentSessionPath(sessionFile);
			if (sessionFile) this.completedBackgroundPaths.delete(sessionFile);
			this.state.setTemporarySession(!session.sessionManager.isPersisted());
			if (resetToolState) clearSessionEventToolState(this.tools);
			this.unsubscribe = session.subscribe((event) => this.handleEvent(event));
			this.state.setActivityText(
				session.isStreaming || this.foregroundObservedRunning
					? "Working..."
					: undefined,
			);
			this.models.sync();
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
		const session = runtime.session;
		// UI bindings belong to a session, not a foreground activation generation.
		const isActive = () => runtime === this.runtime && session === runtime.session;
		await sessionPerformance.measure("extensionBind", () =>
			session.bindExtensions({
				mode: "rpc",
				uiContext: this.extensionUi.context(isActive),
				onError: (error) => {
					if (isActive()) {
						this.state.appendMessage(
							"notice",
							`Extension ${error.extensionPath}: ${error.error}`,
						);
					}
				},
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
		await this.catalog.refresh(this.dependencies.prepareSessions, {
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
					this.notifyRuntimeDone(this.runtime);
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
			formatToolEnd: (toolEvent, args) => {
				const view = formatToolResult(toolEvent.toolName, toolEvent.result, {
					args,
					isError: toolEvent.isError,
				});
				const attachments = toolResultImageAttachments(toolEvent.result);
				return {
					text: view.text,
					options: {
						title: toolTitle(
							toolEvent.isError ? "error" : "success",
							toolEvent.toolName,
							args,
						),
						meta: toolEndMeta(toolEvent.durationMs),
						state: toolEvent.isError ? "error" : "success",
						titleParts: toolTitleParts(toolEvent.toolName, args),
						format: view.format,
						attachments: attachments.length ? attachments : undefined,
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
		const session = this.runtime.session;
		const prompts = session.promptTemplates.map((template) => ({
			name: template.name,
			description: template.description,
			argumentHint: template.argumentHint,
			source: "prompt" as const,
		}));
		const extensions = session.extensionRunner
			.getRegisteredCommands()
			.filter((command) => !systemSlashCommandNames.has(command.name))
			.map((command) => ({
				name: command.invocationName,
				description: command.description ?? "",
				source: "extension" as const,
			}));
		const skills = session.resourceLoader.getSkills().skills.map((skill) => ({
			name: `skill:${skill.name}`,
			description: skill.description,
			source: "skill" as const,
		}));
		this.state.setSlashCommands([
			...systemSlashCommands,
			...prompts,
			...extensions,
			...skills,
		]);
	}

	private loadCurrentSessionMessages(): void {
		const sessionId = this.runtime.session.sessionManager.getSessionId();
		if (
			this.projectedSessionId !== undefined &&
			this.projectedSessionId !== sessionId
		) {
			this.state.resetChat();
		}
		this.projectedSessionId = sessionId;
		sessionPerformance.measureSync("transcriptProjection", () =>
			this.transcript.load(this.runtime, this.state),
		);
		this.usage.sync();
	}
}
