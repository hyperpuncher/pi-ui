import { DatastarClientHub } from "../server/datastar-client-hub.ts";
import type {
	AppRenderSnapshot,
	AppStore,
	AppStorePresentation,
	UiCommitEffect,
} from "../state/app-store.ts";
import { renderAuthDialogContent } from "./auth-dialog.tsx";
import { projectBackendSignals } from "./backend-signals.ts";
import { renderDebugOverlay } from "./debug.tsx";
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
import { renderSessionTransition } from "./session-transition.tsx";
import { renderTreePicker } from "./tree-picker.tsx";

/** Complete-view renderer and logical commit scheduler. */
export class UiRenderer implements AppStorePresentation {
	readonly messages: MessageRenderService;
	private updateDepth = 0;
	private commitPending = false;
	private commitScheduled = false;
	private suppressMessagesDepth = 0;
	private pendingEffects: UiCommitEffect[] = [];
	private pendingEnhancements = new Set<string>();
	private readonly pickersHub = new DatastarClientHub(undefined, false);
	private pickerHtml: string | undefined;
	private readonly sessionHub = new DatastarClientHub(undefined, false);
	private sessionPickerHtml: string | undefined;

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

	createStream(signal: AbortSignal): Response {
		this.flush();
		return this.hub.createStream(signal, () => this.renderView());
	}
	createPickersStream(signal: AbortSignal): Response {
		this.flush();
		return this.pickersHub.createStream(signal, () => {
			const elements = this.renderPickerElements(this.store.snapshot());
			this.pickerHtml = elements;
			return { elements, signals: "{}" };
		});
	}
	createSessionStream(signal: AbortSignal): Response {
		this.flush();
		return this.sessionHub.createStream(signal, () => {
			const elements = renderSessionPickerContent(this.store.snapshot());
			this.sessionPickerHtml = elements;
			return { elements, signals: "{}" };
		});
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
		const snapshot = this.store.snapshot();
		const pickerScripts = this.pickerEffectScripts(effects);
		if (this.pickersHub.clientCount > 0) {
			const elements = this.renderPickerElements(snapshot);
			if (elements !== this.pickerHtml || pickerScripts.length > 0) {
				this.pickerHtml = elements;
				this.pickersHub.patchView(elements, "{}", pickerScripts);
			}
		}
		if (this.hub.clientCount > 0) {
			const view = this.renderView(this.effectSignalOverrides(effects), snapshot);
			this.hub.patchView(
				view.elements,
				view.signals,
				this.mainEffectScripts(effects),
			);
		}
		if (this.sessionHub.clientCount > 0) {
			const elements = renderSessionPickerContent(this.store.snapshot());
			if (elements !== this.sessionPickerHtml) {
				this.sessionPickerHtml = elements;
				this.sessionHub.patchElement(elements, "#session-menu-content");
			}
		}
		for (const id of enhancementIds) this.messages.enqueueEnhancement(id);
	}
	async suppressMessages<T>(callback: () => Promise<T>): Promise<T> {
		this.suppressMessagesDepth += 1;
		try {
			return await callback();
		} finally {
			this.flush();
			this.suppressMessagesDepth -= 1;
		}
	}
	messageAppended(id: string): void {
		this.messages.messageAppended(id);
	}
	messageUpdated(id: string): void {
		this.messages.messageUpdated(id);
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
		this.messages.transcriptReplacing();
	}
	transcriptReplaced(
		activeIds: readonly (string | undefined)[],
		enhancementIds: readonly string[],
	): void {
		this.messages.transcriptReplaced(activeIds, enhancementIds);
	}
	scheduleEnhancements(ids: readonly string[]): void {
		// Newly revealed messages nearest the retained scroll anchor finish first.
		for (const id of ids.toReversed()) this.pendingEnhancements.add(id);
		this.requestCommit();
	}
	enhanceMessage(id: string): boolean {
		return this.messages.enhanceMessage(id);
	}
	setDisplayRefreshHz(hz: number): boolean {
		return this.messages.setDisplayRefreshHz(hz);
	}
	projectMessages(messages: Parameters<MessageRenderService["projectMessages"]>[0]) {
		return this.messages.projectMessages(messages);
	}
	renderMessagesElement(): string {
		return this.messages.renderMessagesElement();
	}

	renderElements(snapshot: AppRenderSnapshot): string {
		const messages =
			this.suppressMessagesDepth > 0
				? ""
				: renderMessages(
						snapshot.messages,
						snapshot.emptyChatHint,
						snapshot.hasOlderMessages,
						snapshot.sessions,
						snapshot.sessionTransition.status !== "idle",
						snapshot.models.some((model) => model.configured),
					);
		return (
			messages +
			renderPromptAction(snapshot) +
			renderPromptQueue(snapshot) +
			renderPromptToolbar(snapshot) +
			renderPromptStatus(snapshot) +
			renderWorkspacePicker(snapshot) +
			renderSessionTransition(snapshot) +
			renderDebugOverlay(snapshot)
		);
	}
	renderPickerElements(snapshot: AppRenderSnapshot): string {
		return (
			renderAuthDialogContent(snapshot.authDialog) +
			renderWorkspaceDialogMenu(snapshot) +
			renderModelPicker(snapshot) +
			renderThinkingPicker(snapshot) +
			renderSlashPicker(snapshot) +
			renderTreePicker(snapshot)
		);
	}
	renderSignals(
		snapshot: AppRenderSnapshot,
		overrides: Record<string, unknown> = {},
	): string {
		return JSON.stringify({
			...projectBackendSignals(snapshot),
			...overrides,
		});
	}
	private renderView(
		overrides: Record<string, unknown> = {},
		snapshot = this.store.snapshot(),
	): {
		elements: string;
		signals: string;
	} {
		return {
			elements: this.renderElements(snapshot),
			signals: this.renderSignals(snapshot, overrides),
		};
	}
	private effectSignalOverrides(
		effects: readonly UiCommitEffect[],
	): Record<string, unknown> {
		return Object.assign(
			{},
			...effects
				.filter((effect) => effect.type === "signal-overrides")
				.map((effect) => effect.values),
		);
	}
	private mainEffectScripts(effects: readonly UiCommitEffect[]): string[] {
		return effects.some((effect) => effect.type === "scroll-messages-to-bottom")
			? ["window.piUi.messageScroll.scrollBottom()"]
			: [];
	}
	private pickerEffectScripts(effects: readonly UiCommitEffect[]): string[] {
		const scripts: string[] = [];
		for (const effect of effects) {
			if (effect.type === "reopen-model-picker")
				scripts.push(
					"window.piUi.basecoat.refresh(document.getElementById('model-select')); requestAnimationFrame(() => document.getElementById('model-select-trigger')?.click())",
				);
			if (effect.type === "auth-dialog")
				scripts.push(
					effect.open
						? "{ const dialog = document.getElementById('auth-dialog'); if (dialog && !dialog.open) dialog.showModal(); }"
						: "document.getElementById('auth-dialog')?.close?.()",
				);
		}
		return [...new Set(scripts)];
	}
}
