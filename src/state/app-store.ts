import type { SessionTransitionState } from "../agent/session-transition-controller.ts";
import {
	isVisibleTerminalOverlay,
	terminalSurfaceDialogId,
	type TerminalSurface,
} from "../agent/terminal-surface/types.ts";
import { appCommandCatalog } from "../commands/catalog.ts";
import {
	type ExtensionChannelSnapshot,
	type PiUiElement,
	isPiUiSheetElement,
	piUiDialogId,
} from "../extension-surface-types.ts";
import { activeKeybind } from "../keybinds.ts";
import {
	emptyLiveWorkspaceSnapshot,
	type LiveWorkspacePreferences,
	type LiveWorkspaceSnapshot,
} from "../live-workspace-types.ts";
import { sessionPerformance } from "../perf/session-performance.ts";
import type { AvailableUpdate } from "../update-check.ts";
import { formatMessageCount } from "../utils/format.ts";
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
	type FinishedAssistantIds,
	type TranscriptMessage,
	type TranscriptMessageInput,
	type TranscriptMessageOptions,
	type TranscriptSnapshot,
} from "./transcript-state.ts";

export type AppChatSnapshot = TranscriptSnapshot;
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
	| {
			id: string;
			kind: "select";
			title: string;
			options: readonly string[];
			/** True when `options` already includes something that acts as its own cancel
			 * (e.g. compact-pct's own "Cancel" row) — the renderer then skips its generic
			 * Cancel footer instead of showing two (round-2 audit m8). Optional/falsy-default
			 * so an existing fixture that doesn't set it keeps today's "always show" behavior. */
			hasOwnCancel?: boolean;
	  }
	| { id: string; kind: "confirm"; title: string; message: string }
	| {
			id: string;
			kind: "input" | "editor";
			title: string;
			placeholder?: string;
			prefill?: string;
	  };
export type AppExtensionStatus = { key: string; text: string };
/**
 * A `pi.registerShortcut()` shortcut — see `src/agent/extension-shortcuts.ts`.
 * `reachableByKeyboard` is false for either of two reasons: `key` collides
 * with one of pi-ui's own keybinds (`src/keybinds.ts`'s catalog) — pi-ui's own
 * bind always wins the keyboard chord (round-5 runtime-validation finding — a
 * real extension's shortcut, valid and unique in the TUI, can still collide
 * with a browser-only pi-ui convenience like "Toggle tool output" that has no
 * TUI equivalent to defer to) — or `key` is one a real browser tab already
 * reserves for itself (Round 6 F3 — Ctrl/Cmd+T/W/N, Ctrl+Tab, F5, …:
 * `extension-shortcuts.ts`'s `browserReservedKeyIds`), so the keydown never
 * reaches page JavaScript at all. Either way, the shortcut itself stays
 * listed and directly invocable — from the `/hotkeys` dialog and the command
 * palette (`command-menu.tsx`) — so it is never silently unreachable,
 * matching F1 §1/§3's requirement that every registered shortcut stays
 * reachable without a physical keyboard.
 */
export type AppExtensionShortcut = {
	key: string;
	description?: string;
	extensionPath: string;
	reachableByKeyboard: boolean;
};
export type AppExtensionWidget = {
	key: string;
	lines: readonly string[];
	placement: "aboveEditor" | "belowEditor";
};
/**
 * One client's reported terminal-cell viewport (see `AppStore.clientViewportCells`'s doc
 * comment for the R7-B `promptColumns`/`overlayPercentColumns` additions).
 */
export type ClientViewportCells = {
	columns: number;
	rows: number;
	promptColumns?: number;
	overlayPercentColumns?: number;
	/**
	 * The width, in cells, of a custom message/entry render card (`.message-custom-render`) in
	 * this client's transcript column: what extension message/entry renderers render at.
	 * `undefined` from a client that cannot measure it yet.
	 */
	transcriptColumns?: number;
};
/**
 * The interactive working indicator an extension configured via
 * `ctx.ui.setWorkingIndicator()`. `undefined` (the field itself, not this
 * type) means "restore the default animated spinner"; `frames: []` means
 * "hide the indicator glyph entirely" (the working message/text can still
 * show); `frames.length === 1` is a static glyph; more frames cycle at
 * `intervalMs` (client-rendered — see `prompt-status.tsx`).
 */
export type AppExtensionWorkingIndicator = {
	frames: readonly string[];
	intervalMs?: number;
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
	limits?: Readonly<AppUsageLimits>;
};
export type AppKeybindHint = { keys: string; description: string };

export type UiCommitEffect =
	| { type: "restore-model-picker" }
	| { type: "open-model-picker" }
	| {
			type: "dialog";
			// `(string & {})` keeps literal autocomplete for the fixed dialog ids
			// while still accepting a PIUI sheet's dynamically slugged id.
			id:
				| "auth-dialog"
				| "command-dialog"
				| "extension-dialog"
				| "hotkeys-dialog"
				| "llama-dialog"
				| "session-dialog"
				| "tree-dialog"
				| (string & {});
			open: boolean;
			/**
			 * Defaults to `true`. `false` only for a terminal-surface overlay whose
			 * `OverlayOptions.nonCapturing` is set — shown non-modally (`.show()`,
			 * no backdrop, no focus trap) so it never steals focus from the prompt.
			 */
			modal?: boolean;
	  }
	| { type: "document-title"; title: string }
	| { type: "scroll-transcript-bottom" }
	| { type: "signal-overrides"; values: JsonObject };

export interface AppStorePresentation {
	beginUpdate(): void;
	endUpdate(commit: boolean, flush: boolean): void;
	requestCommit(effect?: UiCommitEffect): void;
	flush(): void;
	messageAppended(id: string): void;
	messagesRemoved(count: number): void;
	messageUpdated(id: string): void;
	pickersChanged(): void;
	sessionsChanged(): void;
	sessionSidebarChanged(): void;
	workspaceReviewChanged(): void;
	/** The above-editor PIUI widget area and sheet host (`#piui-widgets`/`#piui-sheets`) —
	 * distinct from the Live Workspace Extensions tab, which has its own flag below. */
	extensionElementsChanged(): void;
	/** Terminal surfaces for extension `custom()` overlays and component widgets/footer/
	 * header (`#terminal-surface-overlays`/`#terminal-surface-persistent`). */
	terminalSurfacesChanged(): void;
	/** Live Workspace "Now" tab: turn phase, active tools, queued steering/follow-up. */
	liveWorkspaceNowChanged(): void;
	/** Live Workspace "Agents" tab: the subagent/background-session/channel-entry roster. */
	liveWorkspaceAgentsChanged(): void;
	/** Live Workspace "Activity" tab: the bounded event log. */
	liveWorkspaceActivityChanged(): void;
	/** Live Workspace "Usage" tab. */
	liveWorkspaceUsageChanged(): void;
	/** Live Workspace "Extensions" tab: PIUI elements and channel payloads, rendered in full. */
	liveWorkspaceExtensionsChanged(): void;
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
	sessionsHasMore: boolean;
	sessionCatalogLoading: boolean;
	treeEntries: readonly AppTreeEntry[];
	slashCommands: readonly AppSlashCommand[];
	authDialog: AppAuthDialog | undefined;
	extensionDialog: AppExtensionDialog | undefined;
	extensionStatuses: readonly AppExtensionStatus[];
	extensionShortcuts: readonly AppExtensionShortcut[];
	/** Whether any extension currently has a `ctx.ui.onTerminalInput` listener
	 * registered outside a focused terminal surface — the browser only bothers
	 * matching/forwarding prompt-level keys (`static/app/extension-keys.ts`)
	 * while this is true. See `ExtensionUiController.handlePromptLevelInput`. */
	extensionTerminalInputActive: boolean;
	extensionWidgets: readonly AppExtensionWidget[];
	extensionElements: readonly PiUiElement[];
	extensionChannels: readonly ExtensionChannelSnapshot[];
	terminalSurfaces: readonly TerminalSurface[];
	extensionWorkingIndicator: AppExtensionWorkingIndicator | undefined;
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
	usage: Readonly<AppUsage>;
	activityText: string | undefined;
	queuedSteeringMessages: readonly string[];
	queuedFollowUpMessages: readonly string[];
	workspacePath: string;
	workspaceFilesRevision: number;
	workspaceTreeRevision: number;
	workspaceReview: WorkspaceReviewSnapshot;
	workspaceReviewPreferences: WorkspaceReviewPreferences;
	liveWorkspace: LiveWorkspaceSnapshot;
	liveWorkspacePreferences: LiveWorkspacePreferences;
	recentWorkspaces: readonly string[];
	sessionTransition: SessionTransitionState;
	debugUi: boolean;
	datastarInspector: boolean;
	documentTitle: string;
	updateAvailable: AvailableUpdate | undefined;
	hasOlderMessages: boolean;
	promptHistory: readonly string[];
	promptEditorText: string;
	emptyChatHint: Readonly<AppKeybindHint>;
}>;

type AppStoreUpdateOptions = { flush?: boolean; commit?: boolean };

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
function uniqueStrings(values: string[]): string[] {
	const unique = new Set(values);
	unique.delete("");
	return [...unique];
}
/** The "Now" tab's slice of a `LiveWorkspaceSnapshot` — see `setLiveWorkspace`. */
function nowWorkspaceSlice(
	snapshot: LiveWorkspaceSnapshot,
): Pick<
	LiveWorkspaceSnapshot,
	"turn" | "activeTools" | "queuedSteering" | "queuedFollowUp"
> {
	return {
		turn: snapshot.turn,
		activeTools: snapshot.activeTools,
		queuedSteering: snapshot.queuedSteering,
		queuedFollowUp: snapshot.queuedFollowUp,
	};
}
/** Structural equality for the small, bounded JSON-shaped slices above — cheap next to
 * re-rendering and patching a whole Live Workspace tab for an unrelated change. */
function sameJson<Value>(a: Value, b: Value): boolean {
	return JSON.stringify(a) === JSON.stringify(b);
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
	models: AppModel[] = [];
	sessionCatalogLoading = true;
	private sessionCatalog: AppSessionSummary[] = [];
	private sessionLimit = sessionSidebarPageSize;
	treeEntries: AppTreeEntry[] = [];
	slashCommands: AppSlashCommand[] = [];
	authDialog: AppAuthDialog | undefined;
	extensionDialog: AppExtensionDialog | undefined;
	extensionStatuses: AppExtensionStatus[] = [];
	extensionShortcuts: AppExtensionShortcut[] = [];
	extensionTerminalInputActive = false;
	extensionWidgets: AppExtensionWidget[] = [];
	extensionElements: PiUiElement[] = [];
	extensionChannels: ExtensionChannelSnapshot[] = [];
	terminalSurfaces: TerminalSurface[] = [];
	/**
	 * Per-tab reports of the browser's actual `prefers-color-scheme`, keyed by the page's
	 * stable per-connection client id (`page.tsx`'s `displayClientId`, the same id the SSE
	 * stream and display-refresh Hz reporting already use) — reported once per connection and
	 * on change (see `pi-ui-elements.tsx`'s sheet-mount script). A request that carries no
	 * client id (an older client, or a direct test) falls back to `legacyClientColorSchemeKey`,
	 * matching this store's previous single-scalar behavior exactly.
	 *
	 * Round-4 O4: this used to be a single mutable scalar any tab could overwrite, so whichever
	 * tab last reported "won" for every other tab's terminal surfaces too, even a tab that had
	 * since disconnected. Tracking per client (and clearing an entry on disconnect — see
	 * `clearClientColorScheme`, called from `UiRenderer.createStream`'s disconnect callback)
	 * stops a closed tab from permanently poisoning the scheme for tabs that are still open.
	 * Two *simultaneously open* tabs with different real schemes can still only get one theme
	 * baked into a broadcast terminal-surface render — `DatastarClientHub` sends every client
	 * the same HTML — so this can't make that specific case exact without rendering each
	 * client's surfaces separately, which is out of scope here; it fixes the staleness bug.
	 */
	private readonly clientColorSchemesByClient = new Map<string, "light" | "dark">();
	static readonly legacyClientColorSchemeKey = "__legacy__";
	private mostRecentColorSchemeClientId: string | undefined;

	/**
	 * The scheme used for extension-facing behavior with no specific client to target (a
	 * terminal surface's real `Theme` at `custom()` mount time isn't tied to any one browser
	 * request — see `ExtensionUiController.colorScheme()`). Resolves to the most recently
	 * reported still-connected client's scheme, or `"dark"` — pi-coding-agent's own default and
	 * this app's original always-dark behavior — once every reporting client has disconnected
	 * (round-2 audit m9; round-4 O4). Never part of the render snapshot: it drives
	 * extension-facing behavior only, not any rendered HTML here.
	 */
	get clientColorScheme(): "light" | "dark" {
		const current =
			this.mostRecentColorSchemeClientId !== undefined
				? this.clientColorSchemesByClient.get(this.mostRecentColorSchemeClientId)
				: undefined;
		return current ?? "dark";
	}
	/**
	 * Per-tab reports of the browser's terminal-cell viewport (Round 6 F2), tracked the same
	 * way — and for the same reason (round-4 O4) — as `clientColorSchemesByClient`: a closed
	 * tab must not keep seeding every new surface's guessed size for tabs still open.
	 * `static/app/terminal-keys.js` reports this once per connection and on window resize,
	 * measured the same way `sendResize()` measures an individual surface's grid, but against
	 * the whole viewport rather than one surface's box — necessarily an approximation of what
	 * any *particular* new surface will resolve to once its own `ResizeObserver` fires (a
	 * dialog's own chrome, an overlay's percentage width, differ per surface), but close enough
	 * that a fresh surface's first published frame is never off by the wide margin a fixed
	 * 100-column guess (`defaultTerminalColumns`) was.
	 *
	 * R7-B: alongside the whole viewport, the same report now also carries the client's actually
	 * measured `#prompt-box` width (`promptColumns`) and, for a percentage-width overlay, the
	 * width its `N%` will resolve against once its own dialog chrome is subtracted
	 * (`overlayPercentColumns`, mirroring `terminal-keys.js`'s `percentOverlayAvailableWidth`) —
	 * closing the two remaining first-paint gaps the whole-viewport-only hint still had: a
	 * prompt-column surface (inline/widget/footer/header) painting wider than the actual column
	 * it sits in on a phone, and a percentage overlay painting ~5% too wide before its first real
	 * resize report lands. Both are `undefined` from a client too old to report them, or before
	 * `#prompt-box` exists in the DOM; `TerminalSurfaceController` falls back to the old
	 * viewport-only approximation exactly as before in that case.
	 */
	private readonly clientViewportCellsByClient = new Map<string, ClientViewportCells>();
	static readonly legacyClientViewportKey = "__legacy_viewport__";
	private mostRecentViewportClientId: string | undefined;
	/**
	 * The most recently reported still-connected client's terminal-cell viewport, used to seed
	 * a brand-new terminal surface's initial size (`TerminalSurfaceController`'s
	 * `viewportHint`) instead of a fixed guess. `undefined` before any client has reported one
	 * (a fresh connection's very first surface, if any mounts before the report arrives) or
	 * once every reporting client has disconnected — `TerminalSurfaceController` falls back to
	 * `defaultTerminalColumns`/`defaultTerminalRows` in that case, exactly as before this round.
	 */
	get clientViewportCells(): ClientViewportCells | undefined {
		return this.mostRecentViewportClientId !== undefined
			? this.clientViewportCellsByClient.get(this.mostRecentViewportClientId)
			: undefined;
	}
	/**
	 * The narrowest transcript render width any still-connected client reported. Every tab
	 * shows the same transcript, so a custom message/entry render sized for a wider tab would
	 * wrap mid-line in a narrower one. `undefined` until a client reports one.
	 */
	get narrowestTranscriptColumns(): number | undefined {
		let narrowest: number | undefined;
		for (const size of this.clientViewportCellsByClient.values()) {
			if (size.transcriptColumns === undefined) continue;
			if (narrowest === undefined || size.transcriptColumns < narrowest) {
				narrowest = size.transcriptColumns;
			}
		}
		return narrowest;
	}
	extensionWorkingIndicator: AppExtensionWorkingIndicator | undefined;
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
	usage: AppUsage = { text: "$0.000 • 0 tokens", costText: "$0.000" };
	workspacePath = defaultWorkspacePath();
	workspaceFilesRevision = 0;
	workspaceTreeRevision = 0;
	workspaceReview = unloadedWorkspaceReviewSnapshot;
	workspaceReviewPreferences: WorkspaceReviewPreferences = {};
	liveWorkspace: LiveWorkspaceSnapshot = emptyLiveWorkspaceSnapshot;
	liveWorkspacePreferences: LiveWorkspacePreferences = {};
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
		return running.concat(completed, idle);
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
		const history: string[] = [];
		const messages = this.transcript.allMessages;
		for (let index = messages.length - 1; index >= 0; index -= 1) {
			const message = messages[index]!;
			if (message.role !== "user") continue;
			const text = message.text.trim();
			if (!text || history.at(-1) === text) continue;
			history.push(text);
			if (history.length === 100) break;
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
			sessionsHasMore: this.sessionsHasMore,
			sessionCatalogLoading: this.sessionCatalogLoading,
			treeEntries: this.treeEntries.map((entry) => ({ ...entry })),
			slashCommands: this.slashCommands.map((command) => ({ ...command })),
			authDialog: this.authDialog ? structuredClone(this.authDialog) : undefined,
			extensionDialog: this.extensionDialog
				? structuredClone(this.extensionDialog)
				: undefined,
			extensionStatuses: this.extensionStatuses.map((status) => ({ ...status })),
			extensionShortcuts: this.extensionShortcuts.map((shortcut) => ({
				...shortcut,
			})),
			extensionTerminalInputActive: this.extensionTerminalInputActive,
			extensionWidgets: this.extensionWidgets.map((widget) => ({
				...widget,
				lines: [...widget.lines],
			})),
			// `setExtensionElements`/`setExtensionChannels`/`setTerminalSurfaces` already
			// clone their input on write (below), so the store's own arrays are private,
			// immutable-by-convention copies no caller can alias into — handing them out
			// here directly (instead of `structuredClone`-ing again on every read) drops a
			// deep copy from every commit.
			extensionElements: this.extensionElements,
			extensionChannels: this.extensionChannels,
			terminalSurfaces: this.terminalSurfaces,
			extensionWorkingIndicator: this.extensionWorkingIndicator
				? {
						...this.extensionWorkingIndicator,
						frames: [...this.extensionWorkingIndicator.frames],
					}
				: undefined,
			extensionWorkingMessage: this.extensionWorkingMessage,
			extensionWorkingVisible: this.extensionWorkingVisible,
			llamaDialog: this.llamaDialog ? structuredClone(this.llamaDialog) : undefined,
			currentModel: this.currentModel,
			currentSessionPath: this.currentSessionPath,
			previousSessionPath: this.previousSessionPath,
			isTemporarySession: this.isTemporarySession,
			thinkingLevel: this.thinkingLevel,
			thinkingLevels: [...this.thinkingLevels],
			thinkingHidden: this.thinkingHidden,
			usage: { ...this.usage },
			activityText: this.activityText,
			queuedSteeringMessages: this.queuedSteeringMessages,
			queuedFollowUpMessages: this.queuedFollowUpMessages,
			workspacePath: this.workspacePath,
			workspaceFilesRevision: this.workspaceFilesRevision,
			workspaceTreeRevision: this.workspaceTreeRevision,
			workspaceReview: this.workspaceReview,
			workspaceReviewPreferences: { ...this.workspaceReviewPreferences },
			// `LiveWorkspaceController.snapshot()` (the only producer, see `setLiveWorkspace`)
			// always builds a brand-new object graph, so this reference is never mutated
			// after the fact either — safe to hand out without `structuredClone`-ing again.
			liveWorkspace: this.liveWorkspace,
			liveWorkspacePreferences: { ...this.liveWorkspacePreferences },
			recentWorkspaces: [...this.recentWorkspaces],
			sessionTransition: { ...this.sessionTransition },
			debugUi: this.debugUi,
			datastarInspector: this.datastarInspector,
			documentTitle: this.documentTitle,
			updateAvailable: this.updateAvailable,
			hasOlderMessages: this.hasOlderMessages,
			promptHistory: this.promptHistory,
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
		options: TranscriptMessageOptions = {},
	): string {
		const id = this.transcript.appendMessage(role, text, options);
		this.presentation?.messageAppended(id);
		return id;
	}
	updateMessage(id: string, patch: Partial<Omit<TranscriptMessage, "id">>): void {
		if (!this.transcript.updateMessage(id, patch)) return;
		this.presentation?.messageUpdated(id);
	}
	// Called through the session reducer's computed state-sink member.
	// fallow-ignore-next-line unused-class-member
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
	finishAssistant(): FinishedAssistantIds {
		const ids = this.transcript.finishAssistant();
		this.presentation?.assistantFinished(ids);
		return ids;
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
	replaceMessages(messages: TranscriptMessageInput[]): void {
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
	showRecentMessages(): void {
		if (!this.transcript.showRecentMessages()) return;
		this.presentation?.transcriptReplacing();
		this.presentation?.transcriptReplaced(
			[],
			this.transcript.messages.map((message) => message.id),
		);
		this.commit({ type: "scroll-transcript-bottom" });
	}
	loadOlderMessages(): readonly TranscriptMessage[] {
		return this.transcript.loadOlderMessages();
	}
	trimOldMessages(): readonly string[] {
		return this.transcript.trimOldMessages();
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
	// Native `/model` (no arguments) and `/scoped-models` handling: opens the same model
	// picker the toolbar/keybind use, instead of printing a plain-text model list — the
	// picker already has a per-row scope-toggle star (prompt-pickers.tsx), which doubles
	// as `/scoped-models`' picker.
	requestOpenModelPicker(): void {
		this.presentation?.pickersChanged();
		this.commit({ type: "open-model-picker" });
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
	setSessionCatalogLoading(loading: boolean): void {
		if (this.sessionCatalogLoading === loading) return;
		this.sessionCatalogLoading = loading;
		this.presentation?.sessionsChanged();
		this.commit();
	}
	setSessionCatalog(sessions: AppSessionSummary[]): void {
		this.sessionCatalog = sessions;
		this.presentation?.sessionsChanged();
		this.commit();
	}
	loadMoreSessions(): void {
		this.sessionLimit = Math.min(
			this.sessionLimit + sessionSidebarPageSize,
			this.getSessionCatalog().length,
		);
		this.presentation?.sessionsChanged();
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
				this.presentation?.sessionsChanged();
				this.commit();
			}
			return false;
		}
		this.sessionCatalog = [catalog[index], ...catalog.toSpliced(index, 1)];
		this.presentation?.sessionsChanged();
		this.commit();
		return true;
	}
	updateSessionSummary(
		path: string,
		update: (session: AppSessionSummary) => AppSessionSummary,
		options: { sidebarOnly?: boolean } = {},
	): boolean {
		const catalog = this.getSessionCatalog();
		const index = catalog.findIndex((candidate) => candidate.path === path);
		if (index < 0) return false;
		this.sessionCatalog = catalog.with(index, update(catalog[index]));
		if (options.sidebarOnly) this.presentation?.sessionSidebarChanged();
		else this.presentation?.sessionsChanged();
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
	setExtensionShortcuts(shortcuts: AppExtensionShortcut[]): void {
		this.extensionShortcuts = shortcuts.map((shortcut) => ({ ...shortcut }));
		this.presentation?.pickersChanged();
		this.commit();
	}
	/** See `AppStateSnapshot.extensionTerminalInputActive`. */
	setExtensionTerminalInputActive(active: boolean): void {
		if (this.extensionTerminalInputActive === active) return;
		this.extensionTerminalInputActive = active;
		this.commit();
	}
	setExtensionWidgets(widgets: AppExtensionWidget[]): void {
		this.extensionWidgets = widgets.map((widget) => ({
			...widget,
			lines: [...widget.lines],
		}));
		this.commit();
	}
	setExtensionElements(elements: PiUiElement[]): void {
		// A `sheet`/`screen` element's `<dialog>` only exists in the DOM once
		// rendered, and a freshly created `<dialog>` needs an explicit
		// `showModal()` to actually appear (mirroring `setAuthDialog`/
		// `setExtensionDialog`'s "dialog" effect). Diff against the previous
		// element list's `openGeneration` (not just id, and not `revision`) so only an id
		// that's new OR whose extension deliberately re-`set`/`upsert`-ed it gets an open
		// effect: an already-open sheet just re-renders in place on every commit and must not
		// be told to reopen, but an existing, user-dismissed sheet the extension explicitly
		// re-shows DOES reopen — `openGeneration` only bumps on that deliberate re-show, never
		// on a `patch`/`append` content update (round-2 audit M4a/M4b).
		const previousOpenGenerations = new Map(
			this.extensionElements
				.filter(isPiUiSheetElement)
				.map((element) => [piUiDialogId(element), element.openGeneration]),
		);
		this.extensionElements = elements.map((element) => structuredClone(element));
		// Two independent regions read this list: the above-editor widget/sheet area and
		// the Live Workspace Extensions tab. Each gets its own dirty flag (see A#11/A#13 in
		// the round-2 audit) so an element update never forces the other to re-render too.
		this.presentation?.extensionElementsChanged();
		this.presentation?.liveWorkspaceExtensionsChanged();
		this.commit();
		for (const element of elements.filter(isPiUiSheetElement)) {
			const id = piUiDialogId(element);
			const previousGeneration = previousOpenGenerations.get(id);
			if (
				previousGeneration === undefined ||
				previousGeneration !== element.openGeneration
			) {
				// `pickersChanged()` is what makes `patchDirtyRegions` actually run
				// `pickerEffectScripts` (where "dialog" effects are turned into a
				// `showModal()` script) — matching `setAuthDialog`/
				// `setExtensionDialog`'s identical pairing. The script itself guards on
				// `!dialog.open`, so this is a no-op for a sheet the user hasn't dismissed.
				this.presentation?.pickersChanged();
				this.presentation?.requestCommit({ type: "dialog", id, open: true });
			}
		}
	}
	/**
	 * Records one client's actual light/dark preference (see `clientColorScheme`). No commit:
	 * nothing rendered here depends on it, only extension-facing behavior does.
	 */
	setClientColorScheme(
		value: "light" | "dark",
		clientId: string = AppStore.legacyClientColorSchemeKey,
	): void {
		this.clientColorSchemesByClient.set(clientId, value);
		this.mostRecentColorSchemeClientId = clientId;
	}
	/**
	 * Forgets a client's reported color scheme once its SSE connection closes (see
	 * `UiRenderer.createStream`'s disconnect callback), so a tab that's no longer open can't
	 * keep overriding `clientColorScheme` for the tabs that still are (round-4 O4).
	 */
	clearClientColorScheme(clientId: string): void {
		this.clientColorSchemesByClient.delete(clientId);
		if (this.mostRecentColorSchemeClientId === clientId) {
			// Fall back to another still-connected client's report, if any — arbitrary but
			// deterministic (Map iteration order is insertion order), not "the most recent"
			// since that ordering isn't tracked once the true most-recent client is gone.
			const remaining = [...this.clientColorSchemesByClient.keys()];
			this.mostRecentColorSchemeClientId = remaining.at(-1);
		}
	}
	/**
	 * Records one client's reported terminal-cell viewport (see `clientViewportCells`). No
	 * commit: nothing rendered here depends on it, only a freshly mounted surface's initial
	 * size does.
	 */
	setClientViewportCells(
		size: ClientViewportCells,
		clientId: string = AppStore.legacyClientViewportKey,
	): void {
		this.clientViewportCellsByClient.set(clientId, size);
		this.mostRecentViewportClientId = clientId;
	}
	/**
	 * Forgets a client's reported viewport once its SSE connection closes (see
	 * `UiRenderer.createStream`'s disconnect callback), mirroring `clearClientColorScheme`.
	 */
	clearClientViewportCells(clientId: string): void {
		this.clientViewportCellsByClient.delete(clientId);
		if (this.mostRecentViewportClientId === clientId) {
			const remaining = [...this.clientViewportCellsByClient.keys()];
			this.mostRecentViewportClientId = remaining.at(-1);
		}
	}
	/**
	 * Replaces the full terminal-surface list (see `TerminalSurfaceController`).
	 * Mirrors `setExtensionElements`'s "only newly opened dialogs get a
	 * `showModal()` effect" diffing: an `overlay`-kind surface renders inside
	 * a `<dialog>`, which needs an explicit open effect the first time it
	 * appears (and a close effect once it disappears — the extension called
	 * `done()`/the overlay's `hide()`, or the session switched away).
	 */
	setTerminalSurfaces(surfaces: TerminalSurface[]): void {
		// Open/close effects follow what the browser shows: an overlay rendering nothing (e.g.
		// stashed with `setHidden(true)`) closes, and reopens when it draws again.
		const previousOverlayIds = new Set(
			this.terminalSurfaces
				.values()
				.filter(isVisibleTerminalOverlay)
				.map((surface) => surface.id),
		);
		const nextOverlayIds = new Set(
			surfaces
				.values()
				.filter(isVisibleTerminalOverlay)
				.map((surface) => surface.id),
		);
		const nextModalById = new Map(
			surfaces
				.values()
				.filter(isVisibleTerminalOverlay)
				.map((surface) => [surface.id, !surface.overlayOptions?.nonCapturing]),
		);
		this.terminalSurfaces = surfaces.map((surface) => structuredClone(surface));
		this.presentation?.terminalSurfacesChanged();
		this.commit();
		for (const id of nextOverlayIds) {
			if (!previousOverlayIds.has(id)) {
				this.presentation?.pickersChanged();
				this.presentation?.requestCommit({
					type: "dialog",
					id: terminalSurfaceDialogId(id),
					open: true,
					modal: nextModalById.get(id) ?? true,
				});
			}
		}
		for (const id of previousOverlayIds) {
			if (!nextOverlayIds.has(id)) {
				this.presentation?.pickersChanged();
				this.presentation?.requestCommit({
					type: "dialog",
					id: terminalSurfaceDialogId(id),
					open: false,
				});
			}
		}
	}
	setExtensionChannels(channels: ExtensionChannelSnapshot[]): void {
		this.extensionChannels = channels.map((channel) => structuredClone(channel));
		// Only the Live Workspace Extensions tab renders channel payloads today.
		this.presentation?.liveWorkspaceExtensionsChanged();
		this.commit();
	}
	setExtensionWorking(options: {
		message?: string;
		visible: boolean;
		indicator?: AppExtensionWorkingIndicator;
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
	openTreeDialog(): void {
		this.presentation?.pickersChanged();
		this.commit({ type: "dialog", id: "tree-dialog", open: true });
	}
	// Native `/settings` handling: pi-ui has no separate settings screen, so it opens the
	// existing command palette, which lists every command alongside its shortcut (see
	// src/ui/command-menu.tsx).
	openCommandDialog(): void {
		// pickersChanged() is what makes patchDirtyRegions() actually turn this "dialog"
		// effect into the showModal() script the client runs — see openTreeDialog() below
		// and requestOpenModelPicker() above. Without it the commit still reaches the
		// client (as a no-op signals patch) but the dialog never opens.
		this.presentation?.pickersChanged();
		this.commit({ type: "dialog", id: "command-dialog", open: true });
	}
	// Native `/hotkeys` handling: a dedicated, always-visible reference of every shortcut
	// (see src/ui/hotkeys-dialog.tsx) — unlike the command palette, it also covers the
	// focus-only keybinds that have no command-catalog entry to launch.
	openHotkeysDialog(): void {
		this.presentation?.pickersChanged();
		this.commit({ type: "dialog", id: "hotkeys-dialog", open: true });
	}
	// Native `/resume` handling: opens the same session picker the toolbar/keybind use.
	openSessionDialog(): void {
		this.presentation?.pickersChanged();
		this.commit({ type: "dialog", id: "session-dialog", open: true });
	}
	setUsage(value: AppUsage): void {
		this.usage = value;
		// The Live Workspace pane's Usage tab reads this snapshot too, so it must be
		// re-patched even when nothing else about the pane changed — but only its own
		// region: usage updates roughly once per turn, far less often than active tools,
		// agents or activity, and must not force those tabs to re-render too.
		this.presentation?.liveWorkspaceUsageChanged();
		this.commit();
	}
	setActivityText(value: string | undefined): void {
		if (this.activityText === value) return;
		this.transcript.setActivityText(value);
		this.presentation?.sessionsChanged();
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
		this.presentation?.sessionsChanged();
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
	setWorkspacePath(value: string): void {
		if (this.workspacePath === value) return;
		this.workspacePath = value;
		this.workspaceFilesRevision = 0;
		this.workspaceTreeRevision = 0;
		this.workspaceReview = unloadedWorkspaceReviewSnapshot;
		this.presentation?.pickersChanged();
		this.presentation?.workspaceReviewChanged();
		this.commit();
		this.workspacePathListener?.(value);
	}
	workspaceFilesChanged(treeChanged = true): void {
		this.workspaceFilesRevision += 1;
		if (treeChanged) this.workspaceTreeRevision += 1;
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
	setLiveWorkspace(value: LiveWorkspaceSnapshot): void {
		if (this.liveWorkspace.revision === value.revision) return;
		const previous = this.liveWorkspace;
		this.liveWorkspace = value;
		// `LiveWorkspaceController.snapshot()` bundles the Now/Agents/Activity tabs' state
		// into one object with one revision (see live-workspace-controller.ts), so a bump
		// doesn't say which of the three actually changed — a tool-preview tick and an
		// agent-roster update both land here. Diff the relevant slice against the previous
		// snapshot (cheap: each is bounded — see live-workspace-types.ts's limits) so each
		// tab keeps its own dirty flag and id instead of all three re-rendering together.
		if (!sameJson(nowWorkspaceSlice(previous), nowWorkspaceSlice(value))) {
			this.presentation?.liveWorkspaceNowChanged();
		}
		if (!sameJson(previous.agents, value.agents)) {
			this.presentation?.liveWorkspaceAgentsChanged();
		}
		if (!sameJson(previous.activity, value.activity)) {
			this.presentation?.liveWorkspaceActivityChanged();
		}
		this.commit();
	}
	setLiveWorkspacePreferences(value: LiveWorkspacePreferences): void {
		this.liveWorkspacePreferences = value;
		// A preference change (most commonly the active tab) can flip every section's
		// static `display: none`, so — unlike the frequent per-tab updates above — all
		// five regions need a fresh patch here; this path is user-driven and infrequent.
		this.presentation?.liveWorkspaceNowChanged();
		this.presentation?.liveWorkspaceAgentsChanged();
		this.presentation?.liveWorkspaceUsageChanged();
		this.presentation?.liveWorkspaceActivityChanged();
		this.presentation?.liveWorkspaceExtensionsChanged();
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
