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
import { preservesFinalizedMessageDom, renderMessages } from "./messages.tsx";
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
import type { AppMessage } from "./render-state.ts";
import type { AppRenderSnapshot } from "./render-state.ts";
import { renderSessionSidebarContent, sessionSidebarRowId } from "./session-sidebar.tsx";
import { renderSessionTransition } from "./session-transition.tsx";
import { renderTreePicker } from "./tree-picker.tsx";

/** Complete-view renderer and logical commit scheduler. */
type RenderedView = { elements: string; signals: string };

export class UiRenderer implements AppStorePresentation {
	readonly messages: MessageRenderService;
	private readonly displayClients = new DisplayRefreshClients();
	private updateDepth = 0;
	private commitPending = false;
	private commitScheduled = false;
	private pendingEffects: UiCommitEffect[] = [];
	private pendingEnhancements = new Set<string>();
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
		const state = this.store.snapshot();
		if (this.hub.clientCount > 0) {
			const snapshot = this.projectState(state);
			const regions = this.renderElementRegions(snapshot, false);
			const replaceTranscript =
				this.replaceTranscriptOnCommit && Boolean(regions[0]);
			if (replaceTranscript) this.hub.replaceElement(regions[0], "#messages");
			this.hub.patchView(
				(replaceTranscript ? regions.slice(1) : regions).join(""),
				this.renderSignals(snapshot, this.effectSignalOverrides(effects)),
				[
					...this.mainEffectScripts(effects),
					...this.pickerEffectScripts(effects),
				],
			);
		}
		this.replaceTranscriptOnCommit = false;
		for (const id of enhancementIds) this.messages.enqueueEnhancement(id);
	}
	messageAppended(id: string): void {
		this.messages.messageAppended(id);
	}
	messageUpdated(id: string): void {
		this.messages.messageUpdated(id);
	}
	codeThemeChanged(): void {
		this.messages.codeThemeChanged();
		this.replaceTranscriptOnCommit = true;
		this.requestCommit();
	}
	streamingMessageStarted(id: string): void {
		this.messages.streamingMessageStarted(id);
	}
	streamingMessageChanged(): void {
		this.messages.streamingMessageChanged();
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
		const elements = this.messages.renderOlderMessagesPatch(ids);
		this.hub.patchElement(elements, "#older-messages-trigger", {
			mode: "replace",
			scripts: ["window.piUi.messageScroll.restoreAnchor()"],
		});
		// Newly revealed messages nearest the retained scroll anchor finish first.
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

	renderElements(snapshot: AppRenderSnapshot, includeFinalMessageHtml = true): string {
		return this.renderElementRegions(snapshot, includeFinalMessageHtml).join("");
	}
	private renderElementRegions(
		snapshot: AppRenderSnapshot,
		includeFinalMessageHtml: boolean,
	): string[] {
		const messages = renderMessages(
			includeFinalMessageHtml
				? snapshot.messages
				: snapshot.messages.map(omitPreservedMessageHtml),
			snapshot.emptyChatHint,
			snapshot.hasOlderMessages,
			snapshot.sessions,
			snapshot.models.some((model) => model.configured),
			snapshot.sessionCatalogLoading,
		);
		return [
			messages,
			renderPromptAction(snapshot),
			renderPromptQueue(snapshot),
			renderPromptToolbar(snapshot),
			renderPromptStatus(snapshot),
			renderExtensionWidgets(snapshot, "aboveEditor"),
			renderExtensionWidgets(snapshot, "belowEditor"),
			renderWorkspacePicker(snapshot),
			renderSessionTransition(snapshot),
			renderDebugOverlay(snapshot),
			this.renderPickerElements(snapshot),
			renderSessionPickerContent(snapshot),
			renderSessionSidebarContent(snapshot),
		];
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
		includeFinalMessageHtml = true,
	): RenderedView {
		return {
			elements: this.renderElements(snapshot, includeFinalMessageHtml),
			signals: this.renderSignals(snapshot, overrides),
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
			if (effect.type === "scroll-messages-to-bottom") {
				scripts.push("window.piUi.messageScroll.scrollBottom()");
			}
			if (effect.type === "promote-session-row") {
				scripts.push(
					`window.piUi.sessionSidebar.promoteRow(${JSON.stringify(sessionSidebarRowId(effect.path))})`,
				);
			}
		}
		return scripts;
	}
	private pickerEffectScripts(effects: readonly UiCommitEffect[]): string[] {
		const scripts: string[] = [];
		for (const effect of effects) {
			if (effect.type === "reopen-model-picker")
				scripts.push(
					"window.piUi.basecoat.refresh(document.getElementById('model-select')); requestAnimationFrame(() => { document.getElementById('model-select-trigger')?.click(); window.piUi.modelSearch.restore(); })",
				);
			if (effect.type === "dialog")
				scripts.push(
					effect.open
						? `{ const dialog = document.getElementById('${effect.id}'); if (dialog && !dialog.open) dialog.showModal(); }`
						: `document.getElementById('${effect.id}')?.close?.()`,
				);
		}
		return [...new Set(scripts)];
	}
}

function omitPreservedMessageHtml(message: AppMessage): AppMessage {
	return preservesFinalizedMessageDom(message)
		? { ...message, renderedHtml: undefined }
		: message;
}
