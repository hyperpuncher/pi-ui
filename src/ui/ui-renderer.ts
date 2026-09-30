import { DatastarClientHub } from "../server/datastar-client-hub.ts";
import type {
	AppStateSnapshot,
	AppStore,
	AppStorePresentation,
	UiCommitEffect,
} from "../state/app-store.ts";
import type { TranscriptMessage } from "../state/transcript-state.ts";
import { escapeHtml } from "../utils/html.ts";
import type { JsonObject } from "../utils/json-types.ts";
import { renderAuthDialog } from "./auth-dialog.tsx";
import { projectBackendSignals } from "./backend-signals.ts";
import { renderDebugOverlay } from "./debug.tsx";
import { DisplayRefreshClients } from "./display-refresh-clients.ts";
import { renderExtensionDialog } from "./extension-dialog.tsx";
import { renderExtensionWidgets } from "./extension-widgets.tsx";
import { renderLlamaDialog } from "./llama-dialog.tsx";
import {
	MessageRenderService,
	type MessageRenderServiceOptions,
} from "./message-render-service.ts";
import { renderMessages } from "./messages.tsx";
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
import { renderToolbar } from "./toolbar.tsx";
import { renderTreePicker } from "./tree-picker.tsx";
import { renderWorkspaceReviewData } from "./workspace-review.tsx";

type ViewRegion = "pickers" | "sessions" | "sessionSidebar" | "workspaceReview";
const allRegions: ReadonlySet<ViewRegion> = new Set([
	"pickers",
	"sessions",
	"sessionSidebar",
	"workspaceReview",
]);

/** Renders current state, with a separate lane for transcript streaming. */
export class UiRenderer implements AppStorePresentation {
	readonly messages: MessageRenderService;
	private readonly displayClients = new DisplayRefreshClients();
	private updateDepth = 0;
	private commitPending = false;
	private commitScheduled = false;
	private pendingEffects: UiCommitEffect[] = [];
	private pendingEnhancements = new Set<string>();
	private dirtyRegions = new Set<ViewRegion>();
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

	createStream(signal: AbortSignal, clientId: string = crypto.randomUUID()): Response {
		this.flush();
		this.displayClients.connect(clientId);
		this.messages.setDisplayRefreshHz(this.displayClients.targetHz);
		const disconnect = () => {
			this.displayClients.disconnect(clientId);
			this.messages.setDisplayRefreshHz(this.displayClients.targetHz);
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
					const view = this.renderView(snapshot);
					view.elements =
						this.renderTranscript(this.projectState(snapshot)) +
						view.elements;
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
		const dirtyRegions = this.dirtyRegions;
		this.dirtyRegions = new Set();
		if (this.hub.clientCount > 0) {
			const state = this.store.snapshot();
			if (
				this.replaceTranscriptOnCommit ||
				(dirtyRegions.has("sessions") && state.messages.length === 0)
			) {
				this.hub.replaceElement(
					this.renderTranscript(this.projectState(state)),
					"#messages",
				);
			}
			const view = this.renderView(
				state,
				dirtyRegions,
				this.effectSignalOverrides(effects),
			);
			this.hub.patchView(view.elements, view.signals, this.effectScripts(effects));
		}
		this.replaceTranscriptOnCommit = false;
		if (this.hub.clientCount > 0)
			for (const id of enhancementIds) this.messages.enqueueEnhancement(id);
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
		this.dirtyRegions.add("pickers");
	}
	sessionsChanged(): void {
		this.dirtyRegions.add("sessions");
	}
	sessionSidebarChanged(): void {
		this.dirtyRegions.add("sessionSidebar");
	}
	workspaceReviewChanged(): void {
		this.dirtyRegions.add("workspaceReview");
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
		this.requestCommit(
			scrollToBottom ? { type: "scroll-transcript-bottom" } : undefined,
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
		return (
			`<title id="document-title">${escapeHtml(snapshot.documentTitle)}</title>` +
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
	private renderPickerElements(snapshot: AppStateSnapshot): string {
		return (
			renderAuthDialog(snapshot.authDialog) +
			renderExtensionDialog(snapshot.extensionDialog) +
			renderLlamaDialog(snapshot.llamaDialog) +
			renderWorkspaceDialogMenu(snapshot) +
			renderModelPicker(snapshot) +
			renderThinkingPicker(snapshot) +
			renderSlashPicker(snapshot) +
			renderTreePicker(snapshot)
		);
	}
	renderSignals(snapshot: AppStateSnapshot, overrides: JsonObject = {}): string {
		return JSON.stringify({
			...projectBackendSignals(snapshot),
			...overrides,
		});
	}
	private renderView(
		snapshot: AppStateSnapshot,
		regions: ReadonlySet<ViewRegion> = allRegions,
		overrides: JsonObject = {},
	) {
		let elements = this.renderAppElements(snapshot);
		if (regions.has("pickers")) elements += this.renderPickerElements(snapshot);
		if (regions.has("sessions")) elements += renderSessionPickerContent(snapshot);
		if (regions.has("sessions") || regions.has("sessionSidebar"))
			elements += renderSessionSidebarContent(snapshot);
		if (regions.has("workspaceReview"))
			elements += renderWorkspaceReviewData(
				snapshot.workspacePath,
				snapshot.workspaceFilesRevision,
				snapshot.workspaceTreeRevision,
				snapshot.workspaceReview,
				snapshot.workspaceReviewPreferences,
			);
		return { elements, signals: this.renderSignals(snapshot, overrides) };
	}
	private effectSignalOverrides(effects: readonly UiCommitEffect[]): JsonObject {
		const overrides: JsonObject = {};
		for (const effect of effects) {
			if (effect.type === "signal-overrides")
				Object.assign(overrides, effect.values);
		}
		return overrides;
	}
	private effectScripts(effects: readonly UiCommitEffect[]): string[] {
		const scripts = new Set<string>();
		for (const effect of effects) {
			if (effect.type === "scroll-transcript-bottom")
				scripts.add("window.piUi.messageScroll.scrollBottom()");
			if (effect.type === "restore-model-picker")
				scripts.add(
					"requestAnimationFrame(() => document.getElementById('model-select-input')?.focus())",
				);
			if (effect.type === "open-tree-dialog") {
				scripts.add(
					"{ const dialog = document.getElementById('tree-dialog'); if (dialog && !dialog.open) dialog.showModal(); }",
				);
			}
		}
		return [...scripts];
	}
}
