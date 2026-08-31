import { DatastarClientHub } from "../server/datastar-client-hub.ts";
import type {
	AppStateSnapshot,
	AppStore,
	AppStorePresentation,
	UiCommitEffect,
} from "../state/app-store.ts";
import type { JsonObject } from "../utils/json-types.ts";
import { renderAuthDialogContent } from "./auth-dialog.tsx";
import { projectBackendSignals } from "./backend-signals.ts";
import { renderDebugOverlay } from "./debug.tsx";
import { DisplayRefreshClients } from "./display-refresh-clients.ts";
import { renderExtensionDialogContent } from "./extension-dialog.tsx";
import { renderExtensionWidgets } from "./extension-widgets.tsx";
import { renderLlamaDialogContent } from "./llama-dialog.tsx";
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
import {
	renderModelPicker,
	renderThinkingPicker,
	renderWorkspacePicker,
} from "./prompt-pickers.tsx";
import { renderPromptStatus } from "./prompt-status.tsx";
import { renderPromptToolbar } from "./prompt-toolbar.tsx";
import type { AppRenderSnapshot } from "./render-state.ts";
import { renderSessionSidebarContent } from "./session-sidebar.tsx";
import { renderSessionTransition } from "./session-transition.tsx";
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
	workspaceReview: boolean;
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
	private workspaceReviewDirty = false;
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
		};
		try {
			return this.hub.createStream(
				signal,
				() => this.renderView({}, this.projectState(this.store.snapshot())),
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
			workspaceReview: this.workspaceReviewDirty,
		};
		this.pickersDirty = false;
		this.sessionsDirty = false;
		this.workspaceReviewDirty = false;
		const state = this.store.snapshot();
		if (this.hub.clientCount > 0) {
			const snapshot = this.projectState(state);
			if (this.replaceTranscriptOnCommit) {
				this.hub.replaceElement(this.renderTranscript(snapshot), "#messages");
			}
			this.hub.patchView(
				this.replaceTranscriptOnCommit ? "" : this.renderAppElements(snapshot),
				this.renderSignals(snapshot, this.effectSignalOverrides(effects)),
				this.mainEffectScripts(effects),
			);
			this.patchDirtyRegions(snapshot, effects, dirtyRegions);
		}
		this.replaceTranscriptOnCommit = false;
		for (const id of enhancementIds) this.messages.enqueueEnhancement(id);
	}
	private patchDirtyRegions(
		snapshot: AppRenderSnapshot,
		effects: readonly UiCommitEffect[],
		dirty: DirtyRegions,
	): void {
		if (dirty.pickers) {
			this.hub.patchView(
				this.renderPickerElements(snapshot),
				"{}",
				this.pickerEffectScripts(effects),
			);
		}
		if (dirty.sessions) {
			this.hub.patchView(
				renderSessionPickerContent(snapshot) +
					renderSessionSidebarContent(snapshot) +
					(snapshot.messages.length === 0
						? this.renderTranscript(snapshot)
						: ""),
				"{}",
				[],
			);
		}
		if (dirty.workspaceReview) {
			this.hub.patchView(
				renderWorkspaceReviewData(
					snapshot.workspacePath,
					snapshot.workspaceFilesRevision,
					snapshot.workspaceReview,
					snapshot.workspaceReviewPreferences,
				),
				"{}",
				[],
			);
		}
	}
	messageAppended(id: string): void {
		this.messages.messageAppended(id);
		this.appendMessage(id);
	}
	messagesRemoved(ids: readonly string[]): void {
		this.hub.patchElement(
			"",
			ids.map((id) => `#message-list > [data-message-id="${id}"]`).join(","),
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
		this.messages.messageUpdated(id);
	}
	pickersChanged(): void {
		this.pickersDirty = true;
	}
	sessionsChanged(): void {
		this.sessionsDirty = true;
	}
	workspaceReviewChanged(): void {
		this.workspaceReviewDirty = true;
	}
	codeThemeChanged(): void {
		this.messages.codeThemeChanged();
		this.replaceTranscriptOnCommit = true;
		this.requestCommit();
	}
	fontsChanged(): void {
		this.requestCommit();
	}
	streamingMessageStarted(id: string): void {
		this.messages.streamingMessageStarted(id);
		this.appendMessage(id);
	}
	streamingMessageChanged(): void {
		this.messages.streamingMessageChanged();
	}
	sessionTransitionChanged(scrollToBottom: boolean): void {
		this.hub.patchView(
			"",
			this.renderSignals(this.store.snapshot()),
			scrollToBottom ? ["window.piUi.messageScroll.scrollBottom()"] : [],
		);
	}
	assistantFinished(ids: { assistantId?: string; thoughtId?: string }): void {
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
		this.messages.transcriptReplaced(activeIds, enhancementIds);
	}
	patchOlderMessages(ids: readonly string[]): void {
		this.hub.patchElement(
			this.messages.renderOlderMessagesPatch(ids),
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
		for (const id of ids.toReversed()) this.messages.enqueueEnhancement(id);
	}
	enhanceMessage(id: string): boolean {
		return this.messages.enhanceMessage(id);
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
	renderMessagesElement(): string {
		return this.messages.renderMessagesElement();
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
	private renderAppElements(snapshot: AppRenderSnapshot): string {
		return (
			renderPromptAction(snapshot) +
			renderPromptQueue(snapshot) +
			renderPromptToolbar(snapshot) +
			renderPromptStatus(snapshot) +
			renderExtensionWidgets(snapshot, "aboveEditor") +
			renderExtensionWidgets(snapshot, "belowEditor") +
			renderWorkspacePicker(snapshot) +
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
		overrides: JsonObject = {},
		snapshot = this.projectState(this.store.snapshot()),
	): RenderedView {
		return {
			elements:
				this.renderElements(snapshot) +
				this.renderPickerElements(snapshot) +
				renderSessionPickerContent(snapshot) +
				renderSessionSidebarContent(snapshot) +
				renderWorkspaceReviewData(
					snapshot.workspacePath,
					snapshot.workspaceFilesRevision,
					snapshot.workspaceReview,
					snapshot.workspaceReviewPreferences,
				),
			signals: this.renderSignals(snapshot, overrides),
			scripts: this.initialDialogScripts(snapshot),
		};
	}
	private effectSignalOverrides(effects: readonly UiCommitEffect[]): JsonObject {
		return Object.assign(
			{},
			...effects
				.filter((effect) => effect.type === "signal-overrides")
				.map((effect) => effect.values),
		);
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
	private pickerEffectScripts(effects: readonly UiCommitEffect[]): string[] {
		const scripts: string[] = [];
		for (const effect of effects) {
			if (effect.type === "restore-model-picker")
				scripts.push(
					"requestAnimationFrame(() => document.getElementById('model-select-input')?.focus())",
				);
			if (effect.type === "dialog")
				scripts.push(
					effect.open
						? `{ const dialog = document.getElementById('${effect.id}'); if (dialog && !dialog.open) dialog.showModal(); }`
						: `{ const dialog = document.getElementById('${effect.id}'); if (dialog?.open) dialog.close(); }`,
				);
		}
		return [...new Set(scripts)];
	}
	private initialDialogScripts(snapshot: AppStateSnapshot): string[] {
		return [
			["auth-dialog", snapshot.authDialog],
			["extension-dialog", snapshot.extensionDialog],
			["llama-dialog", snapshot.llamaDialog],
		]
			.filter((entry) => Boolean(entry[1]))
			.map(
				([id]) =>
					`{ const dialog = document.getElementById('${id}'); if (dialog && !dialog.open) dialog.showModal(); }`,
			);
	}
}
