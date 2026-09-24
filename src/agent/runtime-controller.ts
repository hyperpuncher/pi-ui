import { statSync } from "node:fs";
import { basename, extname, isAbsolute, resolve as resolvePath } from "node:path";

import {
	type AgentSessionEvent,
	type AgentSessionRuntime,
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	type CreateAgentSessionRuntimeFactory,
	createAgentSessionServices,
	type CustomEntry,
	getAgentDir,
	ProjectTrustStore,
	SessionManager,
	type SessionStartEvent,
} from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";

// `type: "text"` embeds this at build time (same as the JSON import below), so
// it stays available in a compiled `bun build --compile` binary, unlike a
// runtime `readFileSync` into node_modules.
import agentChangelogText from "../../node_modules/@earendil-works/pi-coding-agent/CHANGELOG.md" with { type: "text" };
import { exportSessionToHtml } from "../../node_modules/@earendil-works/pi-coding-agent/dist/core/export-html/index.js";
import { resolveModelScopeFromModels } from "../../node_modules/@earendil-works/pi-coding-agent/dist/core/model-resolver.js";
import { exportSessionToJsonl } from "../../node_modules/@earendil-works/pi-coding-agent/dist/core/session-export.js";
import { resolvePath as canonicalizeSessionPath } from "../../node_modules/@earendil-works/pi-coding-agent/dist/utils/paths.js";
import agentPackageJson from "../../node_modules/@earendil-works/pi-coding-agent/package.json" with { type: "json" };
import type { PiUiActionRequest } from "../extension-surface-types.ts";
import { activeKeybind, keybindIds } from "../keybinds.ts";
import { sessionPerformance } from "../perf/session-performance.ts";
import { endpoints } from "../server/routes/endpoints.ts";
import {
	type AppExtensionShortcut,
	type AppSlashCommand,
	AppStore,
	type BackgroundSessionStatus,
} from "../state/app-store.ts";
import {
	minimumDisplayHz,
	StreamingFrameScheduler,
} from "../state/streaming-frame-scheduler.ts";
import { TranscriptState } from "../state/transcript-state.ts";
import {
	notifySessionDone,
	type SessionDoneNotification,
} from "../system-notifications.ts";
import { errorMessage } from "../utils/errors.ts";
import { configureAgentHttpProxy, withAgentHttpProxy } from "../utils/http-proxy.ts";
import { moveToTrash } from "../utils/trash.ts";
import { defaultWorkspacePath, formatHomePath } from "../utils/workspace.ts";
import { version as piUiVersion } from "../version.ts";
import { resolveArgumentCompletions } from "./argument-completions.ts";
import { AuthController } from "./auth-controller.ts";
import { type AutoTitleConfig, generateAutoTitle } from "./auto-title.ts";
import {
	BackgroundRuntimeOwnership,
	ownsForegroundGeneration,
	RuntimeOwnershipInvariantError,
} from "./background-runtime-ownership.ts";
import {
	type BuiltinCommandName,
	builtinSlashCommandCatalog,
	isBuiltinCommandName,
	parseSlashCommand,
} from "./builtin-commands.ts";
import { detectCacheMiss, formatCacheMissNotice } from "./cache-miss.ts";
import { CustomRendererHost } from "./custom-renderer-host.ts";
import {
	findExtensionShortcut,
	listExtensionShortcuts,
	reservedAppKeyIds,
} from "./extension-shortcuts.ts";
import { ExtensionUiController } from "./extension-ui-controller.ts";
import type { ExtensionsMode } from "./extensions-config.ts";
import { LiveWorkspaceController } from "./live-workspace-controller.ts";
import {
	createLiveWorkspaceHostExtension,
	createLiveWorkspaceHostOrigin,
	createTappedEventBus,
	type LiveWorkspaceHostOrigin,
	type LiveWorkspaceHostSink,
} from "./live-workspace-host-extension.ts";
import { LlamaController } from "./llama-controller.ts";
import { llamaProviderExtension } from "./llama-provider-extension.ts";
import { ModelController } from "./model-controller.ts";
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
import { resolveSessionDir, sessionDirOverride } from "./session-dir.ts";
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
import { defaultTerminalColumns } from "./terminal-surface/headless-terminal.ts";
import { resolveTranscriptTheme } from "./terminal-surface/theme.ts";
import {
	formatToolResult,
	formatToolStart,
	toolEndMeta,
	toolMeta,
	toolTitle,
	toolTitleParts,
} from "./tool-presentation.ts";
import {
	type TranscriptCustomRenderers,
	TranscriptProjector,
} from "./transcript-projector.ts";
import { type TreeNavigationResult, TreeProjector } from "./tree-projector.ts";
import { UsageController } from "./usage-controller.ts";

const extensionFactories = [llamaProviderExtension];

/**
 * Which Live Workspace host-extension instance was loaded into which session. Each runtime
 * gets its own host extension so updates from background runtimes can be told apart and
 * dropped (background sessions must never bleed into the foreground pane).
 */
const liveWorkspaceOrigins = new WeakMap<object, LiveWorkspaceHostOrigin>();
const modelCatalogForceIntervalMs = 30 * 60 * 1000;
// pi-ui's own commands that aren't part of pi's SDK `BUILTIN_SLASH_COMMANDS` catalog
// (see builtin-commands.ts) — kept separate so the SDK's 24 built-ins stay a faithful,
// undiverged mirror of the SDK.
const piUiOnlySlashCommands = [
	{
		name: "llama",
		description: "Load or unload llama.cpp models",
		source: "system",
	},
] satisfies readonly AppSlashCommand[];
const systemSlashCommands = [
	...builtinSlashCommandCatalog,
	...piUiOnlySlashCommands,
] satisfies readonly AppSlashCommand[];
const systemSlashCommandNames = new Set(
	systemSlashCommands.map((command) => command.name),
);
/** Reverse-channel command bridge-aware extensions register — see `dispatchExtensionUiAction`. */
const piUiEventCommandName = "pi_ui_event";
const changelogUrl = "https://github.com/hyperpuncher/pi-ui/releases";
const agentChangelogUrl =
	"https://github.com/earendil-works/pi-coding-agent/blob/main/CHANGELOG.md";
const CHANGELOG_MAX_LINES = 40;

/**
 * Extracts the body of one `## [version] - date` entry from a "Keep a
 * Changelog"-style CHANGELOG.md: the installed version's entry when found,
 * otherwise the first (newest) one. Returns `undefined` for anything that
 * doesn't parse, rather than dumping the raw file. Capped in size — some
 * entries run long — so `/changelog` never posts an oversized notice.
 */
function latestChangelogEntry(
	text: string,
	installedVersion?: string,
): string | undefined {
	const headingPattern = /^## \[([^\]]+)\][^\n]*$/gm;
	const headings: { version: string; start: number; end: number }[] = [];
	let match: RegExpExecArray | null;
	while ((match = headingPattern.exec(text))) {
		headings.push({ version: match[1], start: match.index, end: -1 });
	}
	if (headings.length === 0) return undefined;
	for (let i = 0; i < headings.length; i++) {
		headings[i].end = i + 1 < headings.length ? headings[i + 1].start : text.length;
	}
	const entry =
		headings.find((heading) => heading.version === installedVersion) ?? headings[0];
	const lines = text.slice(entry.start, entry.end).trimEnd().split("\n");
	const truncated = lines.length > CHANGELOG_MAX_LINES;
	const shown = lines.slice(0, CHANGELOG_MAX_LINES);
	if (truncated) shown.push("…");
	return shown.join("\n");
}

/**
 * A short hash of what a message renderer reads (`content` and `details`), part of
 * the custom-render cache key. Unserializable input (a circular `details`) falls back
 * to the text content alone, which still tells same-millisecond messages apart.
 */
function customMessageFingerprint(message: {
	content: unknown;
	details?: unknown;
}): string {
	let source: string;
	try {
		source = JSON.stringify([message.content, message.details ?? null]) ?? "";
	} catch {
		source = String(message.content);
	}
	return Bun.hash(source).toString(36);
}

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
	/** How extensions are bound (`session.bindExtensions({ mode })`) for every
	 * runtime this controller creates, forks, resumes, or switches to. See
	 * `extensions-config.ts`. Defaults to `"tui"`. */
	extensionsMode?: ExtensionsMode;
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
	private readonly customRenderers = new CustomRendererHost();
	private readonly tree: TreeProjector;
	private foregroundGeneration: number;
	private foregroundObservedRunning: boolean;
	private sharing = false;
	private resetChatOnInvalidation = false;
	// Set for the duration of a `RuntimeController`-driven in-place SDK call (e.g.
	// `runtime.newSession()`) whose caller is going to bind extensions itself
	// afterward. Without this, the SDK's own `finishSessionReplacement()` already
	// triggers the rebind callback below mid-call — against the generation about to
	// be replaced — so the caller's own bind would be a second, redundant one and
	// extensions would see two `session_start` events. See `createNewSession()`.
	private suppressNextRebind = false;
	private disposal: Promise<void> | undefined;
	private initialCatalogLoad: Promise<void> | undefined;
	private lastForcedModelRefreshAt: number | undefined;
	private readonly dependencies: RuntimeControllerDependencies;
	private readonly sessionDir: string | undefined;
	private readonly autoTitlesInFlight = new Set<string>();
	private liveWorkspaceChannelsDirty = false;
	private readonly liveWorkspaceFrames = new StreamingFrameScheduler<true>(() =>
		this.commitLiveWorkspace(),
	);

	private constructor(
		private runtime: AgentSessionRuntime,
		private readonly state: AppStore,
		private readonly runtimeFactory: CreateAgentSessionRuntimeFactory,
		private readonly preparedSessions: Promise<PreparedSessionList>,
		sessionDir: string | undefined,
		private readonly activationOptions: RuntimeControllerActivationOptions,
		private readonly liveWorkspace: LiveWorkspaceController,
	) {
		this.dependencies =
			activationOptions.dependencies ?? runtimeControllerDependencies;
		this.sessionDir = sessionDir;
		this.extensionUi = new ExtensionUiController(state, {
			// PIUI `channel` ops and the `pi.events` tap feed ONE channel store (the
			// LiveWorkspaceController, published into `AppStore.extensionChannels`).
			onChannel: (channel, payload) => {
				this.liveWorkspace.recordChannel(channel, payload);
				this.publishLiveWorkspace({ channels: true });
			},
			onCustomPrompt: (capturing) => {
				const release = this.liveWorkspace.trackCustomPrompt(capturing);
				this.publishLiveWorkspace();
				return () => {
					release();
					this.publishLiveWorkspace();
				};
			},
		});
		this.liveWorkspaceFrames.setDisplayHz(minimumDisplayHz);
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
			sessionDir: resolveSessionDir(this.dependencies.getAgentDir()),
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

	/** How this controller binds extensions for every runtime it owns. See
	 * `extensions-config.ts` for what each mode implies. */
	private get extensionsMode(): ExtensionsMode {
		return this.activationOptions.extensionsMode ?? "tui";
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
		// One controller and one derived extension-factory list per RuntimeController
		// instance: `createRuntime` (below) is reused for every session this controller
		// creates, forks, resumes, or switches to, so the same host extension — and
		// therefore the same LiveWorkspaceController — backs the pane across all of them.
		const liveWorkspace = new LiveWorkspaceController();
		// The controller instance is created below; host-extension updates that arrive before
		// it exists (none should, since extensions bind after construction) are dropped.
		let owner: RuntimeController | undefined;
		const liveWorkspaceSink: LiveWorkspaceHostSink = (origin, update) =>
			owner?.applyLiveWorkspaceHostUpdate(origin, update);
		const createRuntime: CreateAgentSessionRuntimeFactory = async ({
			cwd,
			sessionManager,
			sessionStartEvent,
		}) => {
			const liveWorkspaceOrigin = createLiveWorkspaceHostOrigin();
			const sessionExtensionFactories = [
				...extensionFactories,
				createLiveWorkspaceHostExtension(liveWorkspaceSink, liveWorkspaceOrigin),
			];
			// A#27: every `pi.events` channel any loaded extension publishes reaches the Live
			// Workspace pane, not just a hardcoded subset — see `createTappedEventBus`.
			const liveWorkspaceEventBus = createTappedEventBus((channel, payload) => {
				liveWorkspaceSink(liveWorkspaceOrigin, (controller) =>
					controller.recordChannel(channel, payload),
				);
			});
			const services = await sessionPerformance.measure(
				"runtimeServicesCreate",
				() =>
					createAgentSessionServices({
						cwd,
						resourceLoaderOptions: {
							eventBus: liveWorkspaceEventBus,
							extensionFactories: sessionExtensionFactories,
						},
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
			const availableModels = await withAgentHttpProxy(services.modelRuntime, () =>
				services.modelRuntime.getAvailable(),
			);
			const scopedModels = sessionPerformance.measureSync(
				"scopedModelResolution",
				() =>
					resolveModelScopeFromModels(
						services.settingsManager.getEnabledModels() ?? [],
						availableModels,
					).scopedModels,
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
			liveWorkspaceOrigins.set(session.session, liveWorkspaceOrigin);
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
				liveWorkspace,
			);
			owner = host;
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
		// pi-ui-only command, not part of the SDK's built-in catalog (builtin-commands.ts).
		if (trimmed === "/llama") {
			this.openLlama();
			return true;
		}

		// Every pi built-in (/settings, /model, /tree, ...) is TUI-only at the SDK level —
		// session.prompt() never recognizes them (docs/rpc.md), so left unhandled they'd be
		// sent to the model as plain chat text instead of running or reporting "unsupported".
		// Give all of them a native web-UI handling here instead.
		const parsed = parseSlashCommand(trimmed);
		// A first token containing another "/" is a path ("/Users/me/app.ts fails"), never a
		// command name — send it to the model as ordinary text.
		if (parsed && !parsed.name.includes("/")) {
			if (isBuiltinCommandName(parsed.name)) {
				this.dispatchBuiltinCommand(parsed.name, parsed.args);
				return true;
			}
			// Anything starting with "/" that isn't a built-in, a prompt template, a
			// registered extension command, or a skill (state.slashCommands, kept in sync by
			// syncSlashCommands()) is a typo or a command from an extension that isn't
			// loaded — report it instead of sending it to the model as plain chat text.
			// parseSlashCommand() lowercases the name, while extension, skill, and prompt
			// template names keep their registered case — compare case-insensitively.
			if (
				!this.state.slashCommands.some(
					(command) => command.name.toLowerCase() === parsed.name,
				)
			) {
				this.state.appendMessage(
					"notice",
					`Unknown command: /${parsed.name}. Type / to see available commands.`,
				);
				return true;
			}
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

	/** Dispatch table for every pi built-in slash command. Never forwards to the model. */
	private dispatchBuiltinCommand(name: BuiltinCommandName, args: string): void {
		switch (name) {
			case "settings":
				// No separate settings screen exists; opens the command palette, which
				// lists every preference-changing command (theme, fonts, model, ...).
				this.state.openCommandDialog();
				return;
			case "hotkeys":
				this.state.openHotkeysDialog();
				return;
			case "model":
				void this.dispatchModelCommand(args);
				return;
			case "tree":
			case "fork":
				// TUI's /fork opens a picker of previous user messages to branch from; the
				// web equivalent is the same session-tree dialog /tree opens.
				this.openTree();
				return;
			case "thinking":
				void this.dispatchThinkingCommand(args);
				return;
			case "scoped-models":
				this.dispatchScopedModelsCommand();
				return;
			case "export":
				void this.exportSession(args || undefined);
				return;
			case "import":
				void this.importSession(args);
				return;
			case "share":
				void this.share();
				return;
			case "bug":
				this.state.appendMessage(
					"notice",
					"Bug reporting isn't available in the web UI yet. Please file an issue on the pi-coding-agent GitHub repository instead.",
				);
				return;
			case "copy":
				// Handled client-side (copies the last assistant message to the clipboard)
				// before the prompt ever reaches the server — see static/app/pickers.js.
				// The client only forwards here when there is nothing to copy yet, or as
				// "/copy unavailable" when both the Clipboard API and the execCommand
				// fallback failed, so give both cases real feedback instead of a no-op.
				this.state.appendMessage(
					"notice",
					args.trim() === "unavailable"
						? "Couldn't copy: this browser blocked clipboard access."
						: "Nothing to copy yet.",
				);
				return;
			case "name":
				void this.dispatchNameCommand(args);
				return;
			case "session":
				this.showSessionInfo();
				return;
			case "changelog":
				this.showChangelog();
				return;
			case "clone":
				void this.dispatchCloneCommand();
				return;
			case "trust":
				void this.trustProject();
				return;
			case "login":
				this.openLogin(args || undefined);
				return;
			case "logout":
				this.openLogout();
				return;
			case "new":
				// No confirmation notice (unlike /clone): a new session renders the welcome
				// empty state with recent sessions, which is the confirmation — a notice
				// would replace it with a lone message.
				void this.newSession();
				return;
			case "compact":
				void this.compact(args || undefined);
				return;
			case "resume":
				this.state.openSessionDialog();
				return;
			case "reload":
				void this.reload();
				return;
			case "quit":
				this.state.appendMessage(
					"notice",
					"Quit isn't available in the web UI — close this browser tab instead.",
				);
				return;
		}
	}

	private async dispatchModelCommand(args: string): Promise<void> {
		const ref = args.trim();
		if (!ref) {
			this.openModelPickerOrLogin();
			return;
		}
		if (await this.setModel(ref)) {
			this.state.appendMessage("system", `Model set to ${ref}.`);
		}
	}

	private async dispatchThinkingCommand(args: string): Promise<void> {
		const level = args.trim().toLowerCase();
		const available = this.state.thinkingLevels.join(", ");
		if (!level) {
			this.state.appendMessage(
				"notice",
				`Current thinking level: ${this.state.thinkingLevel}\nAvailable: ${available}`,
				{ noticeTone: "info" },
			);
			return;
		}
		if (await this.setThinkingLevel(level)) {
			this.state.appendMessage("system", `Thinking level set to ${level}.`);
		} else {
			this.state.appendMessage(
				"notice",
				`Invalid thinking level: ${level}. Available: ${available}`,
			);
		}
	}

	private dispatchScopedModelsCommand(): void {
		// The model picker (prompt-pickers.tsx) already has a per-row star toggle for
		// exactly this ("scoped for Ctrl+P cycling"), so it doubles as /scoped-models'
		// picker rather than needing a separate scope-only UI.
		this.openModelPickerOrLogin();
	}

	/**
	 * With no model available the toolbar shows a "no provider" login button instead of
	 * the model picker (prompt-pickers.tsx), so there is no picker to open: `/model` and
	 * `/scoped-models` open the same login dialog that button does rather than doing nothing.
	 */
	private openModelPickerOrLogin(): void {
		if (this.state.models.length === 0) this.openLogin();
		else this.state.requestOpenModelPicker();
	}

	private async dispatchNameCommand(args: string): Promise<void> {
		const title = args.trim();
		if (!title) {
			this.state.appendMessage("notice", "Usage: /name <title>");
			return;
		}
		const path = this.runtime.session.sessionManager.getSessionFile();
		if (!path) {
			this.state.appendMessage("notice", "Temporary sessions cannot be renamed.");
			return;
		}
		// renameSession() already reports its own failures; only /name needs a
		// success confirmation — the session dialog's inline rename shows the
		// new title in place instead, so that caller doesn't want this message.
		if (await this.renameSession(path, title)) {
			this.state.appendMessage("system", `Session renamed to "${title}".`);
		}
	}

	/**
	 * `/clone` itself; `cloneSession()` stays callable without a confirmation notice for other
	 * (non-command) callers. Both of `cloneSession()`'s own failure paths ("cancelled"/"busy"/
	 * "error") already report themselves — the transition overlay for "busy"/"error", its own
	 * "Temporary sessions cannot be cloned." notice for "cancelled" — so only "success" gets a
	 * new message here, matching `/name`'s pattern (round-4 O5).
	 */
	private async dispatchCloneCommand(): Promise<void> {
		if ((await this.cloneSession()).status === "success") {
			this.state.appendMessage("system", "Session cloned.");
		}
	}

	private showSessionInfo(): void {
		const stats = this.runtime.session.getSessionStats();
		const lines = [
			`Session: ${stats.sessionFile ? formatHomePath(stats.sessionFile) : "(unsaved)"}`,
			`Messages: ${stats.userMessages} user, ${stats.assistantMessages} assistant, ${stats.toolCalls} tool calls`,
			`Tokens: ${stats.tokens.input} in, ${stats.tokens.output} out, ${stats.tokens.cacheRead} cache read, ${stats.tokens.cacheWrite} cache write`,
			`Cost: $${stats.cost.toFixed(4)}`,
		];
		this.state.appendMessage("notice", lines.join("\n"), {
			format: "pre",
			noticeTone: "info",
		});
	}

	private showChangelog(): void {
		this.state.appendMessage(
			"system",
			`pi-ui v${piUiVersion} · pi-coding-agent v${agentPackageJson.version}\n\n` +
				`pi-ui release notes: ${changelogUrl}\n` +
				`pi-coding-agent changelog: ${agentChangelogUrl}`,
		);
		const body = latestChangelogEntry(agentChangelogText, agentPackageJson.version);
		if (body) {
			this.state.appendMessage("notice", body, {
				format: "pre",
				noticeTone: "info",
			});
		}
	}

	private async cloneSession(): Promise<SessionTransitionResult> {
		const sourcePath = this.runtime.session.sessionManager.getSessionFile();
		if (!sourcePath) {
			this.state.appendMessage("notice", "Temporary sessions cannot be cloned.");
			return { status: "cancelled" };
		}
		const cwd = this.runtime.session.sessionManager.getCwd();
		return await this.transitionController.run(
			"Clone session",
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

	private async trustProject(): Promise<void> {
		try {
			const cwd = this.runtime.session.sessionManager.getCwd();
			new ProjectTrustStore(this.dependencies.getAgentDir()).set(cwd, true);
			this.state.appendMessage(
				"system",
				`Trusted ${formatHomePath(cwd)} for future sessions.`,
			);
		} catch (error) {
			this.state.appendMessage(
				"notice",
				`Failed to save project trust: ${errorMessage(error)}`,
				{ noticeTone: "error" },
			);
		}
	}

	private exportDefaultBasename(): string {
		const file = this.runtime.session.sessionManager.getSessionFile();
		if (!file)
			return `pi-ui-session-${new Date().toISOString().replace(/[:.]/g, "-")}`;
		return `pi-ui-session-${basename(file, extname(file))}`;
	}

	private async exportSession(argPath?: string): Promise<void> {
		const sessionManager = this.runtime.session.sessionManager;
		const cwd = sessionManager.getCwd();
		const trimmed = argPath?.trim();
		// The exported file always lands directly inside the workspace cwd, ignoring any
		// directory components the caller supplied (`basename` only) — unlike the TUI,
		// this UI can be reached from other devices on a LAN (see the server's --host
		// docs), so `/export <path>` must never be able to write a file anywhere else the
		// server process can reach. This also lets the download link below reuse the
		// existing, already-workspace-scoped workspace file download route.
		const requestedName = trimmed ? basename(trimmed) : undefined;
		// `basename` leaves "." and ".." untouched; they name directories, not an export file.
		if (requestedName === "." || requestedName === "..") {
			this.state.appendMessage(
				"notice",
				"Usage: /export [file.html | file.jsonl] — the file is written to the workspace folder.",
			);
			return;
		}
		const jsonl = requestedName
			? extname(requestedName).toLowerCase() === ".jsonl"
			: false;
		const filename = requestedName || `${this.exportDefaultBasename()}.html`;
		const target = resolvePath(cwd, filename);
		try {
			const outputPath = jsonl
				? exportSessionToJsonl(sessionManager, target)
				: await exportSessionToHtml(sessionManager, undefined, target);
			// The download route resolves `path` against the store's workspace root; only link
			// when the session's cwd is that same folder, so the link can never 404.
			const downloadable =
				resolvePath(cwd) === resolvePath(this.state.workspacePath);
			const downloadUrl = `${endpoints.workspaceFileContent}?download=1&path=${encodeURIComponent(basename(outputPath))}`;
			const exported = `Exported session to ${formatHomePath(outputPath)}`;
			this.state.appendMessage(
				"system",
				downloadable ? `${exported}\n${downloadUrl}` : exported,
			);
		} catch (error) {
			this.state.appendMessage(
				"notice",
				`Failed to export session: ${errorMessage(error)}`,
				{ noticeTone: "error" },
			);
		}
	}

	private async importSession(argPath: string): Promise<void> {
		const trimmed = argPath.trim();
		if (!trimmed) {
			this.state.appendMessage("notice", "Usage: /import <path to .jsonl file>");
			return;
		}
		const cwd = this.runtime.session.sessionManager.getCwd();
		const path = isAbsolute(trimmed) ? trimmed : resolvePath(cwd, trimmed);
		// SessionManager.open() never fails for a missing path: it starts a brand-new session
		// file there, in the server's own cwd, and resuming that would silently switch the
		// workspace. Only import a file that actually exists.
		if (!statSync(path, { throwIfNoEntry: false })?.isFile()) {
			this.state.appendMessage(
				"notice",
				`No session file at ${formatHomePath(path)}`,
				{ noticeTone: "error" },
			);
			return;
		}
		try {
			const manager = this.dependencies.openSessionManager(path, this.sessionDir);
			const target = manager.getSessionFile();
			if (!target) {
				this.state.appendMessage(
					"notice",
					`Could not read session file: ${formatHomePath(path)}`,
					{ noticeTone: "error" },
				);
				return;
			}
			const result = await this.resumeSession(target);
			if (result.status === "error") {
				this.state.appendMessage(
					"notice",
					`Failed to import session: ${formatHomePath(path)}`,
					{ noticeTone: "error" },
				);
			}
		} catch (error) {
			this.state.appendMessage(
				"notice",
				`Failed to import session: ${errorMessage(error)}`,
				{ noticeTone: "error" },
			);
		}
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
		const session = this.backgroundSessions.get(this.backgroundKey(sessionPath));
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
			await this.replaceRuntime(
				cwd,
				this.dependencies.createSessionManager(cwd, this.sessionDir),
				{ type: "session_start", reason: "new" },
			);
		} else {
			this.resetChatOnInvalidation = true;
			// `runtime.newSession()` (SDK, in-place) calls `finishSessionReplacement()`
			// internally, which runs the rebind callback we last set and would bind
			// extensions — emitting `session_start` — before `adoptRuntime` below moves
			// the foreground to the new session's generation. Suppress that one
			// mid-flight rebind so extensions are bound, and `session_start`
			// delivered, exactly once: by `bindSession()` below, against the new
			// session's final generation (compare the in-place session switch, which
			// keeps the SDK's own rebind as its one bind instead).
			this.suppressNextRebind = true;
			let result: { cancelled: boolean };
			try {
				result = await this.runtime.newSession();
			} finally {
				this.resetChatOnInvalidation = false;
				this.suppressNextRebind = false;
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
				const background = this.backgroundSessions.get(
					this.backgroundKey(target),
				);
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
		if (
			this.backgroundSessions.get(this.backgroundKey(targetSessionFile))?.status ===
			"running"
		) {
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
			const backgroundSession = this.backgroundSessions.get(
				this.backgroundKey(targetSessionFile),
			);
			if (backgroundSession) {
				this.unsubscribeBackgroundSession(backgroundSession);
				await backgroundSession.runtime.dispose();
				this.backgroundSessions.delete(this.backgroundKey(targetSessionFile));
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
			sessionManager: this.dependencies.createSessionManager(cwd, this.sessionDir),
		});
		const isActive = () => replacement === this.runtime;
		try {
			await replacement.session.bindExtensions({
				mode: this.extensionsMode,
				uiContext: this.extensionUi.context(isActive, replacement),
				// See `bindSessionExtensions()` for why this is needed at all.
				onError: (error) => {
					if (!isActive()) return;
					this.state.appendMessage(
						"notice",
						`Extension command failed: ${error.error}`,
						{ state: "error" },
					);
					this.extensionUi.cancelPendingDialogs();
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
				const session = this.backgroundSessions.get(this.backgroundKey(path));
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
				const activation = this.backgroundSessions.beginActivation(
					this.backgroundKey(path),
				);
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
					() => this.dependencies.openSessionManager(path, this.sessionDir),
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
				await this.leaveCurrentRuntimeForReplacement(action);
				const replacement = await sessionPerformance.measure(
					"runtimeSwitchCreate",
					() =>
						this.dependencies.createRuntime(this.runtimeFactory, {
							cwd: sessionManager.getCwd(),
							agentDir: this.dependencies.getAgentDir(),
							sessionManager,
						}),
					transitionId,
				);
				this.adoptRuntime(replacement);
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
					// The SDK's in-place switch already ran the rebind callback, which bound
					// the new session's extensions to the current foreground generation. A
					// fresh generation here would make that extension UI context inactive
					// for good: every `ctx.ui` call (notify, setWidget, custom(), dialogs)
					// in the resumed session was silently dropped.
					this.adoptRuntime(this.runtime, {
						generation: this.foregroundGeneration,
						observedRunning: this.runtime.session.isStreaming,
					});
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

	/** Argument completions for `/<commandName> <argumentPrefix>` (see argument-completions.ts). */
	async getArgumentCompletions(
		commandName: string,
		argumentPrefix: string,
	): Promise<readonly AutocompleteItem[]> {
		return await resolveArgumentCompletions(
			this.runtime,
			this.state.models,
			this.state.thinkingLevels,
			commandName,
			argumentPrefix,
		);
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

	clearLiveWorkspaceActivity(): void {
		this.liveWorkspace.clearActivity();
		this.publishLiveWorkspace({ immediate: true });
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
			// `session.reload()` re-runs every extension's `session_start`, which re-mounts its
			// statuses, widgets, footer and header through the still-bound UI context. Clear the
			// previous extension UI just before that happens: clearing it afterwards (as
			// unbindSession() does) would wipe everything the reloaded extensions just set.
			await session.reload({
				beforeSessionStart: () => {
					if (runtime === this.runtime) this.extensionUi.cancelAll();
				},
			});
			if (runtime !== this.runtime) return false;
			this.unbindSession({ cancelExtensionUi: false });
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

	/** Routes a raw terminal byte sequence to a mounted terminal surface. */
	handleTerminalSurfaceInput(surfaceId: string, data: string): boolean {
		return this.extensionUi.handleTerminalSurfaceInput(surfaceId, data);
	}

	/** Applies a client-measured grid resize to a mounted terminal surface. */
	resizeTerminalSurface(
		surfaceId: string,
		cols: number,
		rows: number,
		clientId?: string,
	): boolean {
		return this.extensionUi.resizeTerminalSurface(surfaceId, cols, rows, clientId);
	}

	/** Forgets one client's reported terminal-surface sizes once its connection closes. */
	forgetTerminalSurfaceClient(clientId: string): void {
		this.extensionUi.forgetTerminalSurfaceClient(clientId);
	}

	/**
	 * Routes a user action on a rendered PIUI element (a button click, a form
	 * submit) back to the extension that owns it, by invoking its
	 * `pi_ui_event` command directly — the same command
	 * `~/.pi/agent/extensions/lib/bridge.ts`'s `install()` registers to decode
	 * `POST /extensions/ui/action`'s `{elementId, actionId, value}` as
	 * `base64url(JSON)` args. This deliberately does **not** go through
	 * `session.prompt()`/`RuntimeController.prompt()`: that path is meant for
	 * user-authored chat text, queues behind streaming, and would surface as
	 * transcript noise. Invoking the extension's own command handler works
	 * while the agent is mid-turn and produces no visible message.
	 * Returns `false` (rather than throwing) when no extension in the current
	 * session registered `pi_ui_event` — e.g. the bridge-aware extension that
	 * owned this element unloaded, or the session changed underneath the click.
	 */
	async dispatchExtensionUiAction(request: PiUiActionRequest): Promise<boolean> {
		const session = this.runtime.session;
		// Every bridge-aware extension may register its own `pi_ui_event`; the SDK then
		// suffixes invocation names (`pi_ui_event:1`, `:2`, ...), so match on the base
		// name and deliver to all of them — each bridge only fires handlers it registered.
		const commands = session.extensionRunner
			.getRegisteredCommands()
			.filter((command) => command.name === piUiEventCommandName);
		if (commands.length === 0) return false;
		// `lib/bridge.ts` derives the namespace a reply routes to from
		// `elementId.split(":")[0]`. The browser already posts `${ns}:${id}`
		// (pi-ui-elements.tsx); a bare id (an older page, or a hand-written
		// request) is resolved against this runtime's element store — see A#22.
		// Trade-off: bridge.ts then matches the namespace-wide `${ns}:${action}`
		// handler key, so two elements sharing one `ns` that both listen for the
		// same action id both fire. A bare id would instead fire the element's
		// own handler twice (its `${id}:${action}` key is tried for both the id
		// and the derived namespace) and collide across extensions that reuse
		// default ids such as `panel`, which is worse.
		const resolved = {
			...request,
			elementId: this.extensionUi.resolveElementId(request.elementId, this.runtime),
		};
		const args = Buffer.from(JSON.stringify(resolved), "utf8").toString("base64url");
		for (const command of commands) {
			try {
				await command.handler(
					args,
					session.extensionRunner.createCommandContext(),
				);
			} catch (error) {
				console.error("Extension pi_ui_event handler failed", error);
			}
		}
		return true;
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
		this.liveWorkspaceFrames.clear();
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
		// Brings back whatever PIUI elements this runtime's own store already
		// holds (e.g. re-foregrounding a session that kept updating them while
		// backgrounded) instead of leaving the foreground blank (A#23).
		this.extensionUi.restoreElements(runtime);
	}

	private ownedLiveRuntimeCount(): number {
		return this.backgroundSessions.liveCount(this.isCurrentRuntimeActive());
	}

	/**
	 * Canonicalizes a session file path the same way `session-resume.ts` does
	 * before using it as a `backgroundSessions` key, so registration and lookup
	 * always agree regardless of how the caller spelled the path. In production
	 * `getSessionFile()` already returns an absolute, canonical path, so this is
	 * a no-op there; it only matters cross-platform, where a POSIX-style path
	 * resolves differently than an already-platform-absolute one (e.g. on
	 * Windows, `resolve("/sessions/a.jsonl")` lands under the current drive).
	 */
	private backgroundKey(sessionFile: string): string {
		return canonicalizeSessionPath(sessionFile);
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
			if (this.suppressNextRebind) {
				// This transition's own caller (still on the stack below the SDK call
				// that triggered this rebind) will bind extensions and state itself,
				// against the generation this in-place transition is about to become.
				this.suppressNextRebind = false;
				return;
			}
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
			await this.runtime.dispose();
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
		if (this.backgroundSessions.has(this.backgroundKey(sessionFile))) {
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
		this.backgroundSessions.register(
			this.backgroundKey(sessionFile),
			backgroundSession,
		);
		this.liveWorkspace.setBackgroundSession(
			sessionFile,
			"running",
			formatHomePath(this.runtime.session.sessionManager.getCwd()),
			Date.now(),
		);
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
		const sessionPath =
			backgroundSession.runtime.session.sessionManager.getSessionFile();
		if (this.liveWorkspace.recordEvent(event, { background: true, sessionPath })) {
			this.publishLiveWorkspace();
		}
		const outcome = this.reduceEvent(
			backgroundSession.runtime,
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
				this.liveWorkspace.markBackgroundSessionCompleted(path);
				this.publishLiveWorkspace();
				void this.catalog.refreshPath(path);
			}
			return;
		}
	}

	/**
	 * Applies a Live Workspace host-extension update, but only when it came from the
	 * foreground runtime's host extension instance.
	 */
	private applyLiveWorkspaceHostUpdate(
		origin: LiveWorkspaceHostOrigin,
		update: (controller: LiveWorkspaceController) => void,
	): void {
		if (liveWorkspaceOrigins.get(this.runtime.session) !== origin) return;
		update(this.liveWorkspace);
		this.publishLiveWorkspace({ channels: true });
	}

	/**
	 * Publishes the LiveWorkspaceController snapshot into AppStore. Raw session events are
	 * high-frequency (tool output deltas, queue updates), so ordinary publishes coalesce
	 * through a dedicated low-rate frame scheduler; lifecycle boundaries pass `immediate`.
	 * Channel snapshots go to the single `AppStore.extensionChannels` field on the same
	 * frames, since extension `pi.events` channels (e.g. `subagents:fleet`) can publish on
	 * every streamed token of every subagent.
	 */
	private publishLiveWorkspace(
		options: { immediate?: boolean; channels?: boolean } = {},
	): void {
		if (options.channels) this.liveWorkspaceChannelsDirty = true;
		if (options.immediate) this.liveWorkspaceFrames.flush(true);
		else this.liveWorkspaceFrames.schedule(true);
	}

	private commitLiveWorkspace(): void {
		if (this.liveWorkspaceChannelsDirty) {
			this.liveWorkspaceChannelsDirty = false;
			this.state.setExtensionChannels(this.liveWorkspace.channelSnapshots());
		}
		this.state.setLiveWorkspace(
			this.liveWorkspace.snapshot({
				queuedSteering: this.state.queuedSteeringMessages.length,
				queuedFollowUp: this.state.queuedFollowUpMessages.length,
			}),
		);
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
		this.adoptRuntime(backgroundSession.runtime, backgroundSession);
		restoreSessionEventToolState(this.tools, backgroundSession.tools);
		const sessionFile =
			backgroundSession.runtime.session.sessionManager.getSessionFile();
		if (sessionFile) this.liveWorkspace.removeBackgroundSession(sessionFile);
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

	private unbindSession(options: { cancelExtensionUi?: boolean } = {}): void {
		if (options.cancelExtensionUi ?? true) this.extensionUi.cancelAll();
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
			this.liveWorkspace.resetForegroundSession();
			this.publishLiveWorkspace({ immediate: true, channels: true });
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
			this.syncExtensionShortcuts();
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
		const isActive = () =>
			runtime === this.runtime && generation === this.foregroundGeneration;
		await sessionPerformance.measure("extensionBind", () =>
			session.bindExtensions({
				mode: this.extensionsMode,
				uiContext: this.extensionUi.context(isActive, runtime),
				// The SDK catches a thrown command handler internally (the prompt
				// itself still resolves normally) and reports it only here, so
				// without this it is silently swallowed: no error notice, and any
				// dialog the command opened before throwing is left stuck forever
				// with nothing left to ever respond to it. Surfacing it and
				// recovering the dialog queue only applies while this runtime is
				// still the foreground one — a backgrounded session's own error
				// isn't user-facing right now.
				onError: (error) => {
					if (!isActive()) return;
					this.state.appendMessage(
						"notice",
						`Extension command failed: ${error.error}`,
						{ state: "error" },
					);
					this.extensionUi.cancelPendingDialogs();
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
		// Brings back whatever this runtime's own PIUI element store already
		// holds — a no-op for a fresh runtime, but restores a re-foregrounded
		// or rebound session's elements instead of leaving the view blank
		// (A#23). Harmless if `adoptRuntime()` already did this for the same
		// runtime just above this call.
		if (runtime === this.runtime) this.extensionUi.restoreElements(runtime);
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

	private syncModels(): void {
		this.models.sync();
	}

	private handleEvent(event: AgentSessionEvent): void {
		if (event.type === "agent_start") this.foregroundObservedRunning = true;
		if (event.type === "agent_settled") this.foregroundObservedRunning = false;
		this.state.update(
			() => {
				const outcome = this.reduceEvent(
					this.runtime,
					event,
					this.state,
					this.tools,
					() => this.usage.sync(),
				);
				this.updateSessionCatalogFromEvent(event, this.runtime);
				this.scheduleAutoTitleAfterUserMessage(this.runtime, event);
				if (this.liveWorkspace.recordEvent(event, { background: false })) {
					this.publishLiveWorkspace({
						immediate: event.type === "agent_settled",
					});
				}
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

	/**
	 * Builds fresh `TranscriptCustomRenderers` closures, bound to `runtime`'s
	 * `extensionRunner` (the runtime the event or transcript belongs to, so a
	 * background session renders with its own extensions' renderers, never the
	 * foreground's) plus the connected clients' transcript width and color
	 * scheme (R7-A "custom message + entry renderers"). See
	 * `TranscriptCustomRenderers`' and `CustomRendererHost`'s doc comments.
	 * Read fresh on every call because the runtime changes on session
	 * switch/fork/resume, and the reported width/scheme can change between
	 * messages.
	 */
	private customTranscriptRenderers(
		runtime: AgentSessionRuntime,
	): TranscriptCustomRenderers {
		const extensionRunner = runtime.session.extensionRunner;
		const width = this.customRenderColumns();
		const colorScheme = this.state.clientColorScheme;
		const theme = resolveTranscriptTheme(colorScheme);
		const outputPad = runtime.session.settingsManager?.getOutputPad() ?? 1;
		const renderOptions = { width, colorScheme, expanded: true };
		return {
			renderMessage: (message) => {
				const renderer = extensionRunner.getMessageRenderer(message.customType);
				if (!renderer) return undefined;
				// A live-streamed message carries no persisted entry id yet (that's
				// assigned when the session file is written, after the event fires), so
				// the key is `customType` + the message's millisecond timestamp + a hash
				// of what the renderer reads. The hash matters: one command handler
				// commonly sends several same-type messages within one millisecond, and
				// without it every one after the first reused the first one's render.
				return this.customRenderers.render(
					`msg:${message.customType}:${message.timestamp}:${customMessageFingerprint(message)}`,
					renderOptions,
					() => renderer(message, { expanded: true, outputPad }, theme),
				);
			},
			renderEntry: (entry: CustomEntry) => {
				const renderer = extensionRunner.getEntryRenderer(entry.customType);
				if (!renderer) return undefined;
				return this.customRenderers.render(
					`entry:${entry.id}`,
					renderOptions,
					() => renderer(entry, { expanded: true }, theme),
				);
			},
		};
	}

	/**
	 * The width custom message/entry renders are produced at: the narrowest
	 * transcript card any connected tab measured (the transcript is shared, so
	 * a render sized for a wider tab would wrap mid-line in a narrower one).
	 * Before any tab has measured one, falls back to the same prompt-column /
	 * capped-viewport estimate `TerminalSurfaceController` seeds non-overlay
	 * surfaces with.
	 */
	private customRenderColumns(): number {
		const measured = this.state.narrowestTranscriptColumns;
		if (measured !== undefined) return measured;
		const hint = this.state.clientViewportCells;
		return Math.min(
			hint?.promptColumns ?? hint?.columns ?? defaultTerminalColumns,
			defaultTerminalColumns,
		);
	}

	private reduceEvent(
		runtime: AgentSessionRuntime,
		event: AgentSessionEvent,
		state: SessionEventStateSink,
		tools: SessionEventToolState,
		syncUsage?: () => void,
	) {
		const customRenderers = this.customTranscriptRenderers(runtime);
		return reduceSessionEvent(event, {
			state,
			tools,
			convertMessage: (message, timestamp) =>
				this.transcript.message(
					message,
					timestamp,
					{ includeAssistantError: false },
					customRenderers,
				),
			convertEntry: (entry, timestamp) =>
				this.transcript.customEntry(entry, timestamp, customRenderers),
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
				if (!runtime.session.settingsManager?.getShowCacheMissNotices()) {
					return undefined;
				}
				const miss = detectCacheMiss(
					runtime.session.sessionManager.getEntries(),
					message,
					runtime.session.modelRuntime,
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
			.filter(
				(command) =>
					!systemSlashCommandNames.has(command.name) &&
					// Internal PIUI reverse channel, invoked via dispatchExtensionUiAction().
					command.name !== piUiEventCommandName,
			)
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

	/**
	 * Publishes `pi.registerShortcut()` shortcuts (F1 §1) for the client to
	 * match keydowns against (`static/app/extension-keys.ts`) and the
	 * `/hotkeys` dialog/command palette to list. A shortcut colliding with a
	 * pi-tui built-in never makes it into the published list (the SDK drops it
	 * itself); one colliding with one of pi-ui's own binds is still published,
	 * just flagged `reachableByKeyboard: false` — see `extension-shortcuts.ts`'s
	 * doc comments.
	 */
	private syncExtensionShortcuts(): void {
		const reserved = reservedAppKeyIds(keybindIds().map((id) => activeKeybind(id)));
		const shortcuts: AppExtensionShortcut[] = listExtensionShortcuts(
			this.runtime.session.extensionRunner,
			reserved,
		);
		this.state.setExtensionShortcuts(shortcuts);
	}

	/**
	 * Invokes the `pi.registerShortcut()` handler bound to `keyId` — matched by
	 * the client's `matchesKeyId()` off a keydown, or named directly by a tap
	 * on a command-palette/`/hotkeys` row for one flagged
	 * `reachableByKeyboard: false` (F1 §1/§3) — the way real interactive-mode's
	 * `setupExtensionShortcuts` dispatch does: without blocking the caller,
	 * reporting a thrown/rejected handler as an error notice instead of
	 * propagating it (mirroring `dispatchExtensionUiAction`'s failure
	 * handling). Returns whether a shortcut was found for `keyId` — not
	 * whether its handler succeeded, which the caller has no way to learn
	 * either way once the handler is already running asynchronously.
	 */
	invokeExtensionShortcut(keyId: string): boolean {
		const session = this.runtime.session;
		const shortcut = findExtensionShortcut(session.extensionRunner, keyId);
		if (!shortcut) return false;
		Promise.resolve(shortcut.handler(session.extensionRunner.createContext())).catch(
			(error) => {
				this.state.appendMessage(
					"notice",
					`Shortcut handler error: ${errorMessage(error)}`,
					{ state: "error" },
				);
			},
		);
		return true;
	}

	/**
	 * Routes a key typed at the prompt to any `ctx.ui.onTerminalInput`
	 * listener registered outside a focused terminal surface (F1 §2) — see
	 * `ExtensionUiController.handlePromptLevelInput`'s doc comment.
	 */
	handlePromptLevelInput(data: string): { consumed: boolean } {
		return this.extensionUi.handlePromptLevelInput(data);
	}

	private loadCurrentSessionMessages(): void {
		this.transcript.load(
			this.runtime,
			this.state,
			this.customTranscriptRenderers(this.runtime),
		);
		this.usage.sync();
	}
}
