import {
	isPiUiSheetElement,
	type PiUiElement,
	piUiDialogId,
	piUiDismissedStorageKey,
} from "../extension-surface-types.ts";
import { DatastarClientHub } from "../server/datastar-client-hub.ts";
import type {
	AppStateSnapshot,
	AppStore,
	AppStorePresentation,
	UiCommitEffect,
} from "../state/app-store.ts";
import type { TranscriptMessage } from "../state/transcript-state.ts";
import type { JsonObject } from "../utils/json-types.ts";
import { renderAuthDialogContent } from "./auth-dialog.tsx";
import { projectBackendSignals } from "./backend-signals.ts";
import { renderCommandMenu } from "./command-menu.tsx";
import { renderDebugOverlay } from "./debug.tsx";
import { DisplayRefreshClients } from "./display-refresh-clients.ts";
import { renderExtensionDialogContent } from "./extension-dialog.tsx";
import { renderExtensionWidgets } from "./extension-widgets.tsx";
import { renderHotkeysDialog } from "./hotkeys-dialog.tsx";
import {
	renderLiveWorkspaceActivitySection,
	renderLiveWorkspaceAgentsSection,
	renderLiveWorkspaceData,
	renderLiveWorkspaceExtensionsSection,
	renderLiveWorkspaceNowSection,
	renderLiveWorkspaceUsageSection,
} from "./live-workspace.tsx";
import { renderLlamaDialogContent } from "./llama-dialog.tsx";
import {
	MessageRenderService,
	type MessageRenderServiceOptions,
} from "./message-render-service.ts";
import { renderMessages } from "./messages.tsx";
import { renderPiUiSheets, renderPiUiWidgets } from "./pi-ui-elements.tsx";
import {
	renderSessionPickerContent,
	renderSlashPicker,
	renderWorkspaceDialogMenu,
} from "./pickers.tsx";
import { renderPromptAction } from "./prompt-action.tsx";
import { renderPromptQueue } from "./prompt-box.tsx";
import { renderModelPicker, renderThinkingPicker } from "./prompt-pickers.tsx";
import { renderPromptStart } from "./prompt-start.tsx";
import { renderPromptStatus } from "./prompt-status.tsx";
import type { AppRenderSnapshot } from "./render-state.ts";
import { renderSessionSidebarContent } from "./session-sidebar.tsx";
import { renderSessionTransition } from "./session-transition.tsx";
import {
	renderTerminalSurfaceOverlays,
	renderTerminalSurfacePersistent,
	terminalSurfaceOverlayEffects,
} from "./terminal-surface.tsx";
import { renderToolbar } from "./toolbar.tsx";
import { renderTreePicker } from "./tree-picker.tsx";
import { renderWorkspaceReviewData } from "./workspace-review.tsx";

/** Complete-view renderer and logical commit scheduler. */
type RenderedView = {
	elements: string;
	signals: string;
	scripts: readonly string[];
};

type DirtyRegions = {
	pickers: boolean;
	sessions: boolean;
	sessionSidebar: boolean;
	workspaceReview: boolean;
	extensionElements: boolean;
	terminalSurfaces: boolean;
	liveWorkspaceNow: boolean;
	liveWorkspaceAgents: boolean;
	liveWorkspaceUsage: boolean;
	liveWorkspaceActivity: boolean;
	liveWorkspaceExtensions: boolean;
};

export class UiRenderer implements AppStorePresentation {
	readonly messages: MessageRenderService;
	private readonly displayClients = new DisplayRefreshClients();
	private updateDepth = 0;
	private commitPending = false;
	private commitScheduled = false;
	private pendingEffects: UiCommitEffect[] = [];
	private pendingEnhancements = new Set<string>();
	private pickersDirty = false;
	private sessionsDirty = false;
	private sessionSidebarDirty = false;
	private workspaceReviewDirty = false;
	private extensionElementsDirty = false;
	private terminalSurfacesDirty = false;
	private liveWorkspaceNowDirty = false;
	private liveWorkspaceAgentsDirty = false;
	private liveWorkspaceUsageDirty = false;
	private liveWorkspaceActivityDirty = false;
	private liveWorkspaceExtensionsDirty = false;
	private replaceTranscriptOnCommit = false;

	constructor(
		private readonly store: AppStore,
		private readonly hub: DatastarClientHub,
		options: MessageRenderServiceOptions = {},
	) {
		this.messages = new MessageRenderService(
			store,
			(html, selector) => hub.patchElement(html, selector),
			(id) => this.pendingEnhancements.add(id),
			options,
		);
		store.attachPresentation(this);
	}

	createStream(
		signal: AbortSignal,
		clientId: string = crypto.randomUUID(),
		onDisconnect?: () => void,
	): Response {
		this.flush();
		this.displayClients.connect(clientId);
		this.messages.setDisplayRefreshHz(this.displayClients.targetHz);
		const disconnect = () => {
			this.displayClients.disconnect(clientId);
			this.messages.setDisplayRefreshHz(this.displayClients.targetHz);
			// So a closed tab's reported color scheme can't keep overriding a still-open
			// tab's (round-4 O4) — see `AppStore.clearClientColorScheme`.
			this.store.clearClientColorScheme(clientId);
			// Same reasoning for the viewport hint a freshly mounted terminal surface is
			// seeded from (Round 6 F2) — see `AppStore.clearClientViewportCells`.
			this.store.clearClientViewportCells(clientId);
			// R7-B item 1: same reasoning for a closed tab's own reported terminal-surface
			// sizes (`TerminalSurfaceController.forgetClient`). That lives on whichever
			// `RuntimeController` is current at disconnect time, not on this long-lived
			// renderer/store, so the caller (`stream.ts`, which still has `context.resources`)
			// passes it in rather than this class reaching for a "current host" of its own.
			onDisconnect?.();
			if (this.hub.clientCount === 0) {
				this.pendingEnhancements.clear();
				this.messages.transcriptReplacing();
			}
		};
		try {
			return this.hub.createStream(
				signal,
				() => {
					if (this.hub.clientCount === 1) {
						this.messages.transcriptReplaced(
							[
								this.store.transcript.activeThoughtMessageId,
								this.store.transcript.activeAssistantMessageId,
							],
							[],
						);
					}
					const snapshot = this.store.snapshot();
					const view = this.renderView({}, this.projectState(snapshot));
					if (this.hub.clientCount === 1) {
						// Send the readable initial view before starting final highlighting.
						queueMicrotask(() => {
							if (this.hub.clientCount === 0) return;
							for (const message of snapshot.messages.toReversed())
								this.messages.enqueueEnhancement(message.id);
						});
					}
					return view;
				},
				{ onDisconnect: disconnect },
			);
		} catch (error) {
			disconnect();
			throw error;
		}
	}
	beginUpdate(): void {
		this.updateDepth += 1;
	}
	endUpdate(commit: boolean, flush: boolean): void {
		this.updateDepth -= 1;
		if (commit) this.requestCommit();
		if (this.updateDepth === 0 && this.commitPending) this.requestCommit();
		if (flush) this.flush();
	}
	requestCommit(effect?: UiCommitEffect): void {
		this.commitPending = true;
		if (effect) this.pendingEffects.push(effect);
		if (this.updateDepth > 0 || this.commitScheduled) return;
		this.commitScheduled = true;
		queueMicrotask(() => {
			if (!this.commitScheduled) return;
			this.commitScheduled = false;
			this.flush();
		});
	}
	flush(): void {
		if (this.updateDepth > 0 || !this.commitPending) return;
		this.commitPending = false;
		this.commitScheduled = false;
		const effects = this.pendingEffects;
		this.pendingEffects = [];
		const enhancementIds = [...this.pendingEnhancements];
		this.pendingEnhancements.clear();
		const dirtyRegions: DirtyRegions = {
			pickers: this.pickersDirty,
			sessions: this.sessionsDirty,
			sessionSidebar: this.sessionSidebarDirty,
			workspaceReview: this.workspaceReviewDirty,
			extensionElements: this.extensionElementsDirty,
			terminalSurfaces: this.terminalSurfacesDirty,
			liveWorkspaceNow: this.liveWorkspaceNowDirty,
			liveWorkspaceAgents: this.liveWorkspaceAgentsDirty,
			liveWorkspaceUsage: this.liveWorkspaceUsageDirty,
			liveWorkspaceActivity: this.liveWorkspaceActivityDirty,
			liveWorkspaceExtensions: this.liveWorkspaceExtensionsDirty,
		};
		this.pickersDirty = false;
		this.sessionsDirty = false;
		this.sessionSidebarDirty = false;
		this.workspaceReviewDirty = false;
		this.extensionElementsDirty = false;
		this.terminalSurfacesDirty = false;
		this.liveWorkspaceNowDirty = false;
		this.liveWorkspaceAgentsDirty = false;
		this.liveWorkspaceUsageDirty = false;
		this.liveWorkspaceActivityDirty = false;
		this.liveWorkspaceExtensionsDirty = false;
		if (this.hub.clientCount > 0) {
			const state = this.store.snapshot();
			if (this.replaceTranscriptOnCommit) {
				this.hub.replaceElement(
					this.renderTranscript(this.projectState(state)),
					"#messages",
				);
			}
			this.hub.patchView(
				this.replaceTranscriptOnCommit ? "" : this.renderAppElements(state),
				this.renderSignals(state, this.effectSignalOverrides(effects)),
				this.mainEffectScripts(effects),
			);
			this.patchDirtyRegions(state, effects, dirtyRegions);
		}
		this.replaceTranscriptOnCommit = false;
		if (this.hub.clientCount > 0)
			for (const id of enhancementIds) this.messages.enqueueEnhancement(id);
	}
	private patchDirtyRegions(
		snapshot: AppStateSnapshot,
		effects: readonly UiCommitEffect[],
		dirty: DirtyRegions,
	): void {
		if (dirty.extensionElements) {
			// Must run before the `pickers` branch below: a freshly appeared `sheet`/
			// `screen` element's `<dialog>` needs to already exist in the DOM before that
			// branch's `showModal()` effect script (queued by `setExtensionElements`,
			// which also marks `pickers` dirty) can find and open it.
			this.hub.patchView(
				renderPiUiWidgets(snapshot) + renderPiUiSheets(snapshot),
				"{}",
				[],
			);
		}
		if (dirty.terminalSurfaces) {
			// Same ordering constraint as PIUI sheets: a newly mounted `custom()` overlay's
			// `<dialog>` must exist before the `pickers` branch's `showModal()` effect runs.
			this.hub.patchView(
				renderTerminalSurfacePersistent(snapshot, "aboveEditor") +
					renderTerminalSurfacePersistent(snapshot, "belowEditor") +
					renderTerminalSurfaceOverlays(snapshot),
				"{}",
				[],
			);
		}
		if (dirty.pickers) {
			this.hub.patchView(
				this.renderPickerElements(snapshot),
				"{}",
				this.pickerEffectScripts(effects, snapshot.extensionElements),
			);
		}
		if (dirty.sessions) {
			this.hub.patchView(
				renderSessionPickerContent(snapshot) +
					renderSessionSidebarContent(snapshot) +
					(snapshot.messages.length === 0
						? this.renderTranscript(this.projectState(snapshot))
						: ""),
				"{}",
				[],
			);
		} else if (dirty.sessionSidebar) {
			this.hub.patchView(renderSessionSidebarContent(snapshot), "{}", []);
		}
		if (dirty.workspaceReview) {
			this.hub.patchView(
				renderWorkspaceReviewData(
					snapshot.workspacePath,
					snapshot.workspaceFilesRevision,
					snapshot.workspaceTreeRevision,
					snapshot.workspaceReview,
					snapshot.workspaceReviewPreferences,
				),
				"{}",
				[],
			);
		}
		const liveWorkspaceTab = snapshot.liveWorkspacePreferences.tab ?? "now";
		if (dirty.liveWorkspaceNow) {
			this.hub.patchView(
				renderLiveWorkspaceNowSection(snapshot.liveWorkspace, liveWorkspaceTab),
				"{}",
				[],
			);
		}
		if (dirty.liveWorkspaceAgents) {
			this.hub.patchView(
				renderLiveWorkspaceAgentsSection(
					snapshot.liveWorkspace,
					liveWorkspaceTab,
				),
				"{}",
				[],
			);
		}
		if (dirty.liveWorkspaceUsage) {
			this.hub.patchView(
				renderLiveWorkspaceUsageSection(snapshot.usage, liveWorkspaceTab),
				"{}",
				[],
			);
		}
		if (dirty.liveWorkspaceActivity) {
			this.hub.patchView(
				renderLiveWorkspaceActivitySection(
					snapshot.liveWorkspace,
					liveWorkspaceTab,
				),
				"{}",
				[],
			);
		}
		if (dirty.liveWorkspaceExtensions) {
			this.hub.patchView(
				renderLiveWorkspaceExtensionsSection(snapshot, liveWorkspaceTab),
				"{}",
				[],
			);
		}
	}
	messageAppended(id: string): void {
		if (this.hub.clientCount === 0) return;
		this.messages.messageAppended(id);
		this.appendMessage(id);
	}
	messagesRemoved(count: number): void {
		if (count <= 0) return;
		this.hub.patchElement(
			"",
			`#message-list > [data-message-id]:nth-last-child(n + ${this.store.messages.length + 1})`,
			{ mode: "remove" },
		);
	}
	private appendMessage(id: string): void {
		if (this.store.messages.length === 1) {
			this.hub.patchElement(this.messages.renderMessagesElement(), "#messages");
			return;
		}
		const html = this.messages.renderMessageElement(id);
		if (html)
			this.hub.patchElement(html, "#message-list", {
				mode: "append",
				scripts: ["window.piUi.messageScroll.trimOldMessages()"],
			});
	}
	messageUpdated(id: string): void {
		if (this.hub.clientCount === 0) return;
		this.messages.messageUpdated(id);
	}
	pickersChanged(): void {
		this.pickersDirty = true;
	}
	sessionsChanged(): void {
		this.sessionsDirty = true;
	}
	sessionSidebarChanged(): void {
		this.sessionSidebarDirty = true;
	}
	workspaceReviewChanged(): void {
		this.workspaceReviewDirty = true;
	}
	extensionElementsChanged(): void {
		this.extensionElementsDirty = true;
	}
	terminalSurfacesChanged(): void {
		this.terminalSurfacesDirty = true;
	}
	liveWorkspaceNowChanged(): void {
		this.liveWorkspaceNowDirty = true;
	}
	liveWorkspaceAgentsChanged(): void {
		this.liveWorkspaceAgentsDirty = true;
	}
	liveWorkspaceUsageChanged(): void {
		this.liveWorkspaceUsageDirty = true;
	}
	liveWorkspaceActivityChanged(): void {
		this.liveWorkspaceActivityDirty = true;
	}
	liveWorkspaceExtensionsChanged(): void {
		this.liveWorkspaceExtensionsDirty = true;
	}
	codeThemeChanged(): void {
		if (this.hub.clientCount > 0) this.messages.codeThemeChanged();
		else this.messages.transcriptReplacing();
		this.replaceTranscriptOnCommit = true;
		this.requestCommit();
	}
	fontsChanged(): void {
		this.requestCommit();
	}
	streamingMessageStarted(id: string): void {
		if (this.hub.clientCount === 0) return;
		this.messages.streamingMessageStarted(id);
		this.appendMessage(id);
	}
	streamingMessageChanged(): void {
		if (this.hub.clientCount === 0) return;
		this.messages.streamingMessageChanged();
	}
	sessionTransitionChanged(scrollToBottom: boolean): void {
		if (this.hub.clientCount === 0) return;
		this.hub.patchView(
			"",
			this.renderSignals(this.store.snapshot()),
			scrollToBottom ? ["window.piUi.messageScroll.scrollBottom()"] : [],
		);
	}
	assistantFinished(ids: { assistantId?: string; thoughtId?: string }): void {
		if (this.hub.clientCount === 0) return;
		this.messages.assistantFinished(ids);
	}
	transcriptReplacing(): void {
		this.replaceTranscriptOnCommit = true;
		this.messages.transcriptReplacing();
	}
	transcriptReplaced(
		activeIds: readonly (string | undefined)[],
		enhancementIds: readonly string[],
	): void {
		if (this.hub.clientCount > 0)
			this.messages.transcriptReplaced(activeIds, enhancementIds);
	}
	patchOlderMessages(messages: readonly TranscriptMessage[]): void {
		if (this.hub.clientCount === 0) return;
		this.hub.patchElement(
			this.messages.renderOlderMessagesPatch(messages),
			"#older-messages-trigger",
			{
				mode: "after",
				scripts: ["window.piUi.messageScroll.restoreAnchor()"],
			},
		);
		this.hub.patchElement(
			this.messages.renderOlderMessagesTrigger(),
			"#older-messages-trigger",
		);
		for (const message of messages.toReversed()) {
			this.messages.enqueueEnhancement(message.id);
		}
	}
	setDisplayRefreshHz(clientId: string, hz: number): boolean {
		if (!this.displayClients.setHz(clientId, hz)) return false;
		this.messages.setDisplayRefreshHz(this.displayClients.targetHz);
		return true;
	}
	projectState(snapshot: AppStateSnapshot): AppRenderSnapshot {
		return {
			...snapshot,
			messages: this.messages.projectMessages(snapshot.messages),
		};
	}
	renderElements(snapshot: AppRenderSnapshot): string {
		return this.renderTranscript(snapshot) + this.renderAppElements(snapshot);
	}
	private renderTranscript(snapshot: AppRenderSnapshot): string {
		return renderMessages(
			snapshot.messages,
			snapshot.emptyChatHint,
			snapshot.hasOlderMessages,
			snapshot.sessions,
			snapshot.models.some((model) => model.configured),
			snapshot.sessionCatalogLoading,
		);
	}
	private renderAppElements(snapshot: AppStateSnapshot): string {
		// PIUI widgets/sheets (`#piui-widgets`/`#piui-sheets`) are NOT rendered here: unlike
		// the rest of this region, they have their own dirty flag (`extensionElementsDirty`,
		// patched in `patchDirtyRegions`) so an extension UI update doesn't force a fat morph
		// of the toolbar/prompt status/etc. on every commit, and vice versa (round-2 audit
		// A#11). A fresh connection still gets them once, via `renderView` below.
		return (
			renderPromptAction(snapshot) +
			renderPromptQueue(snapshot) +
			renderToolbar(snapshot) +
			renderPromptStatus(snapshot) +
			renderExtensionWidgets(snapshot, "aboveEditor") +
			renderExtensionWidgets(snapshot, "belowEditor") +
			renderPromptStart(snapshot) +
			renderSessionTransition(snapshot) +
			renderDebugOverlay(snapshot)
		);
	}
	renderPickerElements(snapshot: AppStateSnapshot): string {
		return (
			renderAuthDialogContent(snapshot.authDialog) +
			renderExtensionDialogContent(snapshot.extensionDialog) +
			renderLlamaDialogContent(snapshot.llamaDialog) +
			renderWorkspaceDialogMenu(snapshot) +
			renderModelPicker(snapshot) +
			renderThinkingPicker(snapshot) +
			renderSlashPicker(snapshot) +
			renderTreePicker(snapshot) +
			renderHotkeysDialog(snapshot) +
			renderCommandMenu(snapshot)
		);
	}
	renderSignals(snapshot: AppStateSnapshot, overrides: JsonObject = {}): string {
		return JSON.stringify({
			...projectBackendSignals(snapshot),
			...overrides,
		});
	}
	private renderView(
		overrides: JsonObject = {},
		snapshot = this.projectState(this.store.snapshot()),
	): RenderedView {
		return {
			elements:
				this.renderElements(snapshot) +
				renderPiUiWidgets(snapshot) +
				renderPiUiSheets(snapshot) +
				renderTerminalSurfacePersistent(snapshot, "aboveEditor") +
				renderTerminalSurfacePersistent(snapshot, "belowEditor") +
				renderTerminalSurfaceOverlays(snapshot) +
				this.renderPickerElements(snapshot) +
				renderSessionPickerContent(snapshot) +
				renderSessionSidebarContent(snapshot) +
				renderWorkspaceReviewData(
					snapshot.workspacePath,
					snapshot.workspaceFilesRevision,
					snapshot.workspaceTreeRevision,
					snapshot.workspaceReview,
					snapshot.workspaceReviewPreferences,
				) +
				renderLiveWorkspaceData(
					snapshot.liveWorkspace,
					snapshot.liveWorkspacePreferences,
					snapshot.usage,
					snapshot,
				),
			signals: this.renderSignals(snapshot, overrides),
			scripts: this.initialDialogScripts(snapshot),
		};
	}
	private effectSignalOverrides(effects: readonly UiCommitEffect[]): JsonObject {
		const overrides: JsonObject = {};
		for (const effect of effects) {
			if (effect.type === "signal-overrides")
				Object.assign(overrides, effect.values);
		}
		return overrides;
	}
	private mainEffectScripts(effects: readonly UiCommitEffect[]): string[] {
		const scripts: string[] = [];
		for (const effect of effects) {
			if (effect.type === "document-title") {
				scripts.push(`document.title = ${JSON.stringify(effect.title)}`);
			}
			if (effect.type === "scroll-transcript-bottom") {
				scripts.push("window.piUi.messageScroll.scrollBottom()");
			}
		}
		return scripts;
	}
	private pickerEffectScripts(
		effects: readonly UiCommitEffect[],
		extensionElements: readonly PiUiElement[],
	): string[] {
		const scripts = new Set<string>();
		const sheetsByDialogId = new Map(
			extensionElements
				.values()
				.filter(isPiUiSheetElement)
				.map((element) => [piUiDialogId(element), element] as const),
		);
		for (const effect of effects) {
			if (effect.type === "restore-model-picker")
				scripts.add(
					"requestAnimationFrame(() => document.getElementById('model-select-input')?.focus())",
				);
			if (effect.type === "open-model-picker") {
				// Same script the switch-model keybind runs (prompt-pickers.tsx): clicking
				// the popovertarget trigger opens the native popover and reuses its own
				// open handler (which also refreshes the model list) rather than
				// duplicating that logic here.
				scripts.add("document.getElementById('model-select-trigger')?.click();");
			}
			if (effect.type === "dialog") {
				scripts.add(
					!effect.open
						? `{ const dialog = document.getElementById('${effect.id}'); if (dialog?.open) dialog.close(); }`
						: // Only terminal-surface overlay effects carry `modal` (see
							// `AppStore.setTerminalSurfaces`); every other dialog keeps the plain
							// `showModal()` open and its own focus handling.
							effect.modal !== undefined
							? terminalSurfaceOverlayOpenScript(effect.id, effect.modal)
							: this.dialogOpenScript(
									effect.id,
									sheetsByDialogId.get(effect.id),
								),
				);
			}
		}
		return [...scripts];
	}
	private initialDialogScripts(snapshot: AppStateSnapshot): string[] {
		const staticIds = (
			[
				["auth-dialog", snapshot.authDialog],
				["extension-dialog", snapshot.extensionDialog],
				["llama-dialog", snapshot.llamaDialog],
			] as const
		)
			.values()
			.filter((entry) => Boolean(entry[1]))
			.map(([id]) => id)
			.toArray();
		const scripts = staticIds.map(
			(id) =>
				`{ const dialog = document.getElementById('${id}'); if (dialog && !dialog.open) dialog.showModal(); }`,
		);
		for (const effect of terminalSurfaceOverlayEffects(snapshot)) {
			scripts.push(terminalSurfaceOverlayOpenScript(effect.id, effect.modal));
		}
		scripts.push(
			...snapshot.extensionElements
				.filter(isPiUiSheetElement)
				.map((element) => this.piUiSheetReopenScript(element)),
		);
		return scripts;
	}
	/**
	 * A PIUI sheet's open effect goes through the same dismissal-aware script as a fresh
	 * connection: its element list is cleared and restored whenever the session is unbound
	 * and rebound (`/new`, `/reload`, a session switch), which makes every sheet look newly
	 * added, and a plain `showModal()` would re-pop sheets the user already dismissed (and
	 * swallow whatever they were typing into the prompt).
	 */
	private dialogOpenScript(id: string, sheet: PiUiElement | undefined): string {
		return sheet
			? this.piUiSheetReopenScript(sheet)
			: `{ const dialog = document.getElementById('${id}'); if (dialog && !dialog.open) dialog.showModal(); }`;
	}
	/**
	 * Auto-opens a `sheet`/`screen` PIUI element on a fresh connection (reload, reconnect,
	 * new tab) — unless this same browser previously dismissed this exact open generation of
	 * it (see `dismissAction` in pi-ui-elements.tsx and `piUiDismissedStorageKey`); a
	 * `durable` sheet the extension never removes must stay closed instead of reopening every
	 * time (A#16). Keyed on `openGeneration` rather than `revision` so a streaming sheet's
	 * `patch`/`append` updates don't undo the dismissal on the next reload (M4b).
	 */
	private piUiSheetReopenScript(element: PiUiElement): string {
		const id = piUiDialogId(element);
		const key = piUiDismissedStorageKey(element);
		const openGeneration = JSON.stringify(String(element.openGeneration));
		// One line, like the other effect scripts, so SSE framing never splits it.
		return `{ const dialog = document.getElementById('${id}'); let dismissedGeneration; try { dismissedGeneration = localStorage.getItem(${JSON.stringify(key)}); } catch {} if (dialog && !dialog.open && dismissedGeneration !== ${openGeneration}) dialog.showModal(); }`;
	}
}

/**
 * A terminal-surface overlay opens non-modally (`.show()`, no focus trap,
 * no backdrop) when its `OverlayOptions.nonCapturing` is set — matching
 * pi-tui's own "don't capture keyboard focus" contract — and additionally
 * moves focus into its hidden input proxy (`terminal-keys.js`) once modal,
 * so a `SelectList`-style overlay is immediately keyboard-interactive
 * without the user having to click into it first.
 */
function terminalSurfaceOverlayOpenScript(id: string, modal: boolean): string {
	const open = modal ? "dialog.showModal()" : "dialog.show()";
	const focus = modal
		? " dialog.querySelector('[data-terminal-surface-input]')?.focus();"
		: "";
	return `{ const dialog = document.getElementById('${id}'); if (dialog && !dialog.open) { ${open};${focus} } }`;
}
