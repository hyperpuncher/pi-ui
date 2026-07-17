import { type DatastarClientHub } from "../server/datastar-client-hub.ts";
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
import {
	renderModelPicker,
	renderPromptAction,
	renderPromptQueue,
	renderPromptStatus,
	renderPromptToolbar,
	renderThinkingPicker,
	renderWorkspacePicker,
} from "./prompt-box.tsx";
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
		if (this.hub.clientCount > 0) {
			const view = this.renderView(this.effectSignalOverrides(effects));
			this.hub.patchView(view.elements, view.signals, this.effectScripts(effects));
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
			renderAuthDialogContent(snapshot.authDialog) +
			renderPromptAction(snapshot) +
			renderPromptQueue(snapshot) +
			renderPromptToolbar(snapshot) +
			renderPromptStatus(snapshot) +
			renderWorkspacePicker(snapshot) +
			renderWorkspaceDialogMenu(snapshot) +
			renderSessionPickerContent(snapshot) +
			renderModelPicker(snapshot) +
			renderThinkingPicker(snapshot) +
			renderSessionTransition(snapshot) +
			renderDebugOverlay(snapshot) +
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
	private renderView(overrides: Record<string, unknown> = {}): {
		elements: string;
		signals: string;
	} {
		const snapshot = this.store.snapshot();
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
	private effectScripts(effects: readonly UiCommitEffect[]): string[] {
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
