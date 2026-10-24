import { sessionPerformance } from "#src/perf/session-performance.ts";
import { DatastarClientHub } from "#src/server/datastar-client-hub.ts";
import {
	searchWorkspaces,
	type WorkspaceSuggestion,
} from "#src/server/workspace-search.ts";
import type {
	AppStateSnapshot,
	AppStore,
	AppStorePresentation,
	UiCommitEffect,
} from "#src/state/app-store.ts";
import type { TranscriptMessage } from "#src/state/transcript-state.ts";
import { renderAuthDialog } from "#src/ui/auth-dialog.tsx";
import { projectBackendSignals } from "#src/ui/backend-signals.ts";
import { renderDebugOverlay } from "#src/ui/debug.tsx";
import { renderExtensionDialog } from "#src/ui/extension-dialog.tsx";
import { renderExtensionWidgets } from "#src/ui/extension-widgets.tsx";
import { renderLlamaDialog } from "#src/ui/llama-dialog.tsx";
import {
	MessageRenderService,
	type MessageRenderServiceOptions,
} from "#src/ui/message-render-service.ts";
import { renderOlderMessagesTrigger } from "#src/ui/messages.tsx";
import {
	renderSessionPickerContent,
	renderSlashPicker,
	renderWorkspaceDialogMenu,
} from "#src/ui/pickers.tsx";
import { renderPromptAction } from "#src/ui/prompt-action.tsx";
import { renderPromptQueue } from "#src/ui/prompt-box.tsx";
import { renderModelPicker, renderThinkingPicker } from "#src/ui/prompt-pickers.tsx";
import { renderPromptStart } from "#src/ui/prompt-start.tsx";
import { renderPromptStatus } from "#src/ui/prompt-status.tsx";
import type { AppRenderSnapshot } from "#src/ui/render-state.ts";
import {
	renderSessionSidebarContent,
	sessionSidebarLayoutKey,
} from "#src/ui/session-sidebar.tsx";
import { renderSessionTransition } from "#src/ui/session-transition.tsx";
import { renderToolbar } from "#src/ui/toolbar.tsx";
import { renderTreePicker } from "#src/ui/tree-picker.tsx";
import { renderWorkspaceReviewData } from "#src/ui/workspace-review.tsx";
import type { JsonObject } from "#src/utils/json-types.ts";

type WorkspaceSearchView = { query: string; results: readonly WorkspaceSuggestion[] };
type ClientView = {
	sessionQuery: string;
	slashQuery: string;
	workspaceSearch: WorkspaceSearchView;
};

/** Renders current state, with a separate lane for transcript streaming. */
export class UiRenderer implements AppStorePresentation {
	readonly messages: MessageRenderService;
	private readonly view: ClientView = {
		sessionQuery: "",
		slashQuery: "",
		workspaceSearch: { query: "", results: [] },
	};
	private commitScheduled = false;
	private fullViewPending = false;
	private pendingEffects: UiCommitEffect[] = [];
	private pendingEnhancements = new Set<string>();
	private transcriptPending = false;
	private compactTools: boolean;
	private sidebarLayout = "";

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
		this.compactTools = this.messages.compactTools;
		store.attachPresentation(this);
	}

	createStream(
		signal: AbortSignal,
		query = "",
		workspaceQuery = "",
		slashQuery = "",
	): Response {
		this.flush();
		const view = this.view;
		view.sessionQuery = query;
		view.slashQuery = slashQuery;
		view.workspaceSearch = { query: workspaceQuery, results: [] };
		const disconnect = () => {
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
					this.sidebarLayout = sessionSidebarLayoutKey(snapshot);
					const elements =
						this.messages.renderTranscript(snapshot) +
						this.renderView(snapshot, view) +
						renderSessionSidebarContent(snapshot);
					if (workspaceQuery.trim())
						queueMicrotask(() => {
							void this.setWorkspaceSearch(workspaceQuery);
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
				{ onDisconnect: disconnect },
			);
		} catch (error) {
			disconnect();
			throw error;
		}
	}
	setSessionSearch(query: string): void {
		if (this.view.sessionQuery === query) return;
		this.view.sessionQuery = query;
		this.viewChanged();
	}

	setSlashSearch(query: string): void {
		if (this.view.slashQuery === query) return;
		this.view.slashQuery = query;
		this.viewChanged();
	}

	async setWorkspaceSearch(query: string): Promise<void> {
		const search: WorkspaceSearchView = { query, results: [] };
		this.view.workspaceSearch = search;
		const results = await searchWorkspaces(this.store.workspacePath, query);
		if (this.view.workspaceSearch !== search) return;
		search.results = results;
		this.viewChanged();
	}

	viewChanged(): void {
		this.fullViewPending = true;
		this.requestCommit();
	}
	requestCommit(effect?: UiCommitEffect): void {
		if (effect?.type === "render-transcript") this.transcriptPending = true;
		else if (effect) this.pendingEffects.push(effect);
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
		const toolPresentationChanged = this.compactTools !== this.messages.compactTools;
		this.compactTools = this.messages.compactTools;
		if (this.hub.clientCount > 0) {
			const state = sessionPerformance.measureSync("stateSnapshot", () =>
				this.store.snapshot(),
			);
			if (this.transcriptPending || toolPresentationChanged) {
				this.hub.patchElement(
					sessionPerformance.measureSync("transcriptRender", () =>
						this.messages.renderTranscript(state),
					),
					"#messages",
					{ scripts: ["window.piUi.messageScroll.checkOlder()"] },
				);
			}
			const sidebarLayout = sessionSidebarLayoutKey(state);
			const sidebarMoved = sidebarLayout !== this.sidebarLayout;
			if (fullView || sidebarMoved) {
				this.sidebarLayout = sidebarLayout;
				this.hub.patchElement(
					sessionPerformance.measureSync("sidebarRender", () =>
						renderSessionSidebarContent(state),
					),
					"#session-sidebar-content",
					{
						useViewTransition: sidebarMoved,
						viewTransitionSelector: "#session-sidebar-viewport",
					},
				);
			}
			this.hub.patchView(
				() =>
					sessionPerformance.measureSync("viewRender", () =>
						fullView
							? this.renderView(state, this.view)
							: this.renderAppElements(state),
					),
				sessionPerformance.measureSync("signalRender", () =>
					this.renderSignals(state, this.effectSignalOverrides(effects)),
				),
				this.effectScripts(effects),
			);
		}
		this.transcriptPending = false;
		if (this.hub.clientCount > 0)
			for (const id of enhancementIds) this.messages.enqueueEnhancement(id);
	}
	messageAppended(id: string): void {
		if (this.hub.clientCount === 0) return;
		this.messages.messageAppended(id);
		this.requestCommit({ type: "render-transcript" });
	}
	messagesRemoved(ids: readonly string[]): void {
		this.messages.dropMessages(ids);
		this.hub.patchElement(
			"",
			`#message-list > :nth-child(-n+${ids.length} of .message[id])`,
			{ mode: "remove" },
		);
		this.hub.patchElement(
			renderOlderMessagesTrigger(this.store.hasOlderMessages),
			"#older-messages-trigger",
		);
	}
	messageUpdated(id: string): void {
		if (this.hub.clientCount === 0) return;
		this.messages.messageUpdated(id);
	}
	codeThemeChanged(): void {
		if (this.hub.clientCount > 0) this.messages.codeThemeChanged();
		else this.messages.transcriptReplacing();
		this.transcriptPending = true;
		this.requestCommit();
	}
	streamingMessageStarted(id: string): void {
		if (this.hub.clientCount === 0) return;
		this.messages.streamingMessageStarted(id);
		this.requestCommit({ type: "render-transcript" });
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
		this.transcriptPending = true;
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
			this.hub.executeScript("window.piUi.messageScroll.beforeOlder()");
			this.hub.patchElement(
				messages.map(({ id }) => this.messages.renderMessageElement(id)).join(""),
				"#older-messages-trigger",
				{
					mode: "after",
					scripts: ["window.piUi.messageScroll.afterOlder()"],
				},
			);
		}
		if (!this.store.hasOlderMessages) {
			this.hub.patchElement(
				renderOlderMessagesTrigger(false),
				"#older-messages-trigger",
			);
		}
		for (const message of messages.toReversed()) {
			this.messages.enqueueEnhancement(message.id);
		}
	}
	projectState(snapshot: AppStateSnapshot): AppRenderSnapshot {
		return {
			...snapshot,
			messages: this.messages.projectMessages(snapshot.messages),
		};
	}
	private renderAppElements(snapshot: AppStateSnapshot): string {
		return (
			`<title id="document-title">${Bun.escapeHTML(snapshot.documentTitle)}</title>` +
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
	private renderPickerElements(snapshot: AppStateSnapshot, view?: ClientView): string {
		return (
			renderAuthDialog(snapshot.authDialog) +
			renderExtensionDialog(snapshot.extensionDialog) +
			renderLlamaDialog(snapshot.llamaDialog) +
			renderModelPicker(snapshot) +
			renderThinkingPicker(snapshot) +
			renderSlashPicker(snapshot, view?.slashQuery) +
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
			this.renderPickerElements(snapshot, view) +
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
