import { DatastarClientHub } from "../server/datastar-client-hub.ts";
import {
	searchWorkspaces,
	type WorkspaceSuggestion,
} from "../server/workspace-search.ts";
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

type WorkspaceSearchView = { query: string; results: readonly WorkspaceSuggestion[] };
type ClientView = {
	sessionQuery: string;
	modelQuery: string;
	workspaceSearch: WorkspaceSearchView;
};

/** Renders current state, with a separate lane for transcript streaming. */
export class UiRenderer implements AppStorePresentation {
	readonly messages: MessageRenderService;
	private readonly displayClients = new DisplayRefreshClients();
	private readonly clientViews = new Map<string, ClientView>();
	private commitScheduled = false;
	private fullViewPending = false;
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

	createStream(
		signal: AbortSignal,
		clientId: string = crypto.randomUUID(),
		query = "",
		workspaceQuery = "",
		modelQuery = "",
	): Response {
		this.flush();
		const view: ClientView = {
			sessionQuery: query,
			modelQuery,
			workspaceSearch: { query: workspaceQuery, results: [] },
		};
		this.clientViews.set(clientId, view);
		this.displayClients.connect(clientId);
		this.messages.setDisplayRefreshHz(this.displayClients.targetHz);
		const disconnect = () => {
			if (this.clientViews.get(clientId) === view)
				this.clientViews.delete(clientId);
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
					const elements =
						this.renderTranscript(this.projectState(snapshot)) +
						this.renderView(snapshot, view);
					if (workspaceQuery.trim())
						queueMicrotask(() => {
							if (this.clientViews.get(clientId) === view)
								void this.setWorkspaceSearch(clientId, workspaceQuery);
						});
					if (this.hub.clientCount === 1) {
						// Send the readable initial view before starting final highlighting.
						queueMicrotask(() => {
							if (this.hub.clientCount === 0) return;
							for (const message of snapshot.messages.toReversed())
								this.messages.enqueueEnhancement(message.id);
						});
					}
					return { elements, signals: this.renderSignals(snapshot) };
				},
				{ clientId, onDisconnect: disconnect },
			);
		} catch (error) {
			disconnect();
			throw error;
		}
	}
	setSessionSearch(clientId: string, query: string): void {
		const view = this.clientViews.get(clientId);
		if (!view || view.sessionQuery === query) return;
		view.sessionQuery = query;
		this.viewChanged();
	}

	setModelSearch(clientId: string, query: string): void {
		const view = this.clientViews.get(clientId);
		if (!view || view.modelQuery === query) return;
		view.modelQuery = query;
		this.viewChanged();
	}

	async setWorkspaceSearch(clientId: string, query: string): Promise<void> {
		const view = this.clientViews.get(clientId);
		if (!view) return;
		const search: WorkspaceSearchView = { query, results: [] };
		view.workspaceSearch = search;
		const results = await searchWorkspaces(this.store.workspacePath, query);
		if (this.clientViews.get(clientId) !== view || view.workspaceSearch !== search)
			return;
		search.results = results;
		this.viewChanged();
	}

	viewChanged(): void {
		this.fullViewPending = true;
		this.requestCommit();
	}
	requestCommit(effect?: UiCommitEffect): void {
		if (effect) this.pendingEffects.push(effect);
		if (this.commitScheduled) return;
		this.commitScheduled = true;
		queueMicrotask(() => this.flush());
	}
	private flush(): void {
		if (!this.commitScheduled) return;
		this.commitScheduled = false;
		const effects = this.pendingEffects;
		this.pendingEffects = [];
		const fullView = this.fullViewPending;
		this.fullViewPending = false;
		const enhancementIds = [...this.pendingEnhancements];
		this.pendingEnhancements.clear();
		if (this.hub.clientCount > 0) {
			const state = this.store.snapshot();
			if (this.replaceTranscriptOnCommit) {
				this.hub.replaceElement(
					this.renderTranscript(this.projectState(state)),
					"#messages",
				);
			}
			this.hub.patchView(
				(clientId) =>
					fullView
						? this.renderView(state, this.clientViews.get(clientId))
						: this.renderAppElements(state),
				this.renderSignals(state, this.effectSignalOverrides(effects)),
				this.effectScripts(effects),
			);
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
	codeThemeChanged(): void {
		if (this.hub.clientCount > 0) this.messages.codeThemeChanged();
		else this.messages.transcriptReplacing();
		this.replaceTranscriptOnCommit = true;
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
		this.requestCommit({
			type: "signal-overrides",
			values: { _sessionTransitionPending: false },
		});
		if (scrollToBottom) this.requestCommit({ type: "scroll-transcript-bottom" });
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
		if (messages.length > 0) {
			this.hub.patchElement(
				this.messages.renderOlderMessagesPatch(messages),
				"#older-messages-trigger",
				{ mode: "after" },
			);
		}
		this.hub.patchElement(
			this.messages.renderOlderMessagesTrigger(),
			"#older-messages-trigger",
			{ scripts: ["window.piUi.messageScroll.restoreAnchor()"] },
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
	private renderPickerElements(snapshot: AppStateSnapshot, modelQuery = ""): string {
		return (
			renderAuthDialog(snapshot.authDialog) +
			renderExtensionDialog(snapshot.extensionDialog) +
			renderLlamaDialog(snapshot.llamaDialog) +
			renderModelPicker(snapshot, modelQuery) +
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
	private renderView(snapshot: AppStateSnapshot, view?: ClientView): string {
		const query = view?.sessionQuery ?? "";
		return (
			this.renderAppElements(snapshot) +
			this.renderPickerElements(snapshot, view?.modelQuery) +
			renderWorkspaceDialogMenu(
				snapshot,
				view?.workspaceSearch.query,
				view?.workspaceSearch.results,
			) +
			renderSessionPickerContent(
				query.trim()
					? {
							...snapshot,
							sessions: this.store.searchSessions(query),
							sessionsHasMore: false,
						}
					: snapshot,
				query,
			) +
			renderSessionSidebarContent(snapshot) +
			renderWorkspaceReviewData(
				snapshot.workspacePath,
				snapshot.workspaceFilesRevision,
				snapshot.workspaceTreeRevision,
				snapshot.workspaceReview,
				snapshot.workspaceReviewPreferences,
			)
		);
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
			if (effect.type === "open-tree-dialog") {
				scripts.add(
					"{ const dialog = document.getElementById('tree-dialog'); if (dialog && !dialog.open) dialog.showModal(); }",
				);
			}
		}
		return [...scripts];
	}
}
