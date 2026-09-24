import type {
	AgentSessionRuntime,
	AutocompleteProviderFactory,
	ExtensionUIContext,
	ExtensionUIDialogOptions,
	ReadonlyFooterDataProvider,
	TerminalInputHandler,
	Theme,
	WorkingIndicatorOptions,
} from "@earendil-works/pi-coding-agent";

/** Not re-exported from the package root; derived from the context methods. */
type EditorFactory = Parameters<ExtensionUIContext["setEditorComponent"]>[0];
type CustomOptions = Parameters<ExtensionUIContext["custom"]>[1];

import type {
	AppExtensionDialog,
	AppExtensionWidget,
	AppExtensionWorkingIndicator,
	AppStore,
} from "../state/app-store.ts";
import type { JsonValue } from "../utils/json-types.ts";
import { isString } from "../utils/type-guards.ts";
import { PiUiBridgeDecoder, PiUiElementStore } from "./pi-ui-bridge.ts";
import {
	resolveOverlayOptions,
	TerminalSurfaceController,
	type CustomComponentFactory,
} from "./terminal-surface/terminal-surface-controller.ts";
import type { TerminalSurfaceColorScheme } from "./terminal-surface/theme.ts";
import { stripAnsi } from "./tool-presentation.ts";

const defaultWorkingVisible = true;

/**
 * A `Theme` stand-in for the web UI, where there is no terminal to paint
 * ANSI escapes into. Every styling method degrades to identity (returns its
 * text argument unstyled) instead of throwing, so an extension that always
 * calls `ctx.ui.theme.fg(...)` — rather than gating on `ctx.mode === "tui"` —
 * still runs to completion. `pi-ui` does not currently expose a way to
 * recolor extension-authored `Component` trees anyway (see `custom()`
 * below), so styling calls here are inherently cosmetic no-ops.
 */
// SAFETY: every trap below returns a plausible value for its property; no
// real `Theme` internals (private `fgColors`/`bgColors`/`mode` fields) are
// ever read through this placeholder.
const identityTheme = new Proxy({} as Theme, {
	get(_target, property) {
		if (property === "name") return "pi-ui";
		if (property === "sourcePath" || property === "sourceInfo") return undefined;
		if (property === "getColorMode") return () => "truecolor";
		if (property === "getFgAnsi" || property === "getBgAnsi") return () => "";
		if (
			property === "getThinkingBorderColor" ||
			property === "getBashModeBorderColor"
		) {
			return () => (text: string) => text;
		}
		// fg/bg/bold/italic/underline/inverse/strikethrough all take the text to
		// style as their last argument and otherwise only take style keys.
		return (...args: unknown[]) => args.findLast(isString) ?? "";
	},
});

type PiUiRuntimeStore = {
	decoder: PiUiBridgeDecoder;
	elements: PiUiElementStore;
};

type PendingDialog = {
	dialog: AppExtensionDialog;
	respond(value: string | undefined, cancelled: boolean): void;
	signal?: AbortSignal;
	abort?: () => void;
	timer?: ReturnType<typeof setTimeout>;
};

/** Result of running every `ctx.ui.onTerminalInput` listener over one key/byte
 * sequence — see `#runTerminalInputHandlers`'s doc comment. */
type TerminalInputRoutingResult = {
	consumed: boolean;
	data: string;
};

/** Result of `handlePromptLevelInput` — whether some `ctx.ui.onTerminalInput`
 * listener consumed the key; there is no rewritten `data` to hand back since,
 * unlike a terminal surface, there is no fallback component to forward it to. */
type PromptLevelInputResult = {
	consumed: boolean;
};

export type ExtensionUiControllerHooks = {
	/**
	 * Receives PIUI `channel` ops. When set, the owner stores channel snapshots (so PIUI
	 * channels and the `pi.events` tap share one store) and this controller does not
	 * write `AppStore.extensionChannels` itself.
	 */
	onChannel?: (channel: string, payload: JsonValue) => void;
	/**
	 * Overrides the browser client's reported light/dark preference (see
	 * `colorScheme()`/`AppStore.clientColorScheme`), for the real `Theme` a terminal surface's
	 * `Component` tree is mounted with. Only needed by a caller that already tracks this some
	 * other way, or a test that wants a fixed scheme; leave unset to use the client's real,
	 * reported preference.
	 */
	colorScheme?: () => TerminalSurfaceColorScheme;
	/**
	 * Called when a `custom()` call starts, with whether it takes keyboard focus (an inline
	 * component or a capturing overlay) or not (a `nonCapturing` overlay); the returned
	 * function runs once it settles.
	 */
	onCustomPrompt?: (capturing: boolean) => () => void;
};

/** Bridges pi extension UI requests to backend-owned web state. */
export class ExtensionUiController {
	readonly #queue: PendingDialog[] = [];
	readonly #statuses = new Map<string, string>();
	readonly #widgets = new Map<string, AppExtensionWidget>();
	/**
	 * Widget keys an extension mounted a `(tui, theme) => Component` factory
	 * onto instead of a `string[]`. These now mount a real terminal surface
	 * (see `#terminalSurfaces`, keyed by `widgetSurfaceId(key)`); this set
	 * only tracks which keys are component-owned so `setWidget(key, [...])`
	 * later can tell a stale surface needs disposing.
	 */
	readonly #componentWidgetKeys = new Set<string>();
	/**
	 * `ctx.ui.onTerminalInput` listeners, per runtime like `#piUiStores`: an
	 * extension registers them once from `session_start`, so they must survive
	 * the runtime being backgrounded and re-foregrounded without a rebind
	 * (`RuntimeController.activateRuntime`), which never re-runs
	 * `session_start`. Only `#inputRuntime`'s listeners are routed.
	 */
	readonly #terminalInputHandlers = new WeakMap<
		AgentSessionRuntime,
		Set<TerminalInputHandler>
	>();
	/** The foreground runtime whose listeners receive input; `undefined`
	 * between `cancelAll()` and the next `restoreElements()`. */
	#inputRuntime: AgentSessionRuntime | undefined;
	readonly #autocompleteProviders: AutocompleteProviderFactory[] = [];
	/**
	 * One PIUI decoder/element store per runtime (session) — never a single
	 * shared one for "the current foreground runtime". A `WeakMap` needs no
	 * manual cleanup: once a runtime is disposed and dropped from every
	 * other collection, its entry here becomes collectable on its own.
	 * `notify()` always applies an incoming PIUI op to the *owning*
	 * runtime's own store, foreground or not, so a backgrounded session's
	 * elements are never lost; `restoreElements()` republishes a runtime's
	 * store into `AppStore` when it becomes (or resumes being) the
	 * foreground one (A#23).
	 */
	readonly #piUiStores = new WeakMap<AgentSessionRuntime, PiUiRuntimeStore>();
	readonly #terminalSurfaces: TerminalSurfaceController;
	#active: PendingDialog | undefined;
	#workingIndicator: AppExtensionWorkingIndicator | undefined;
	#workingMessage: string | undefined;
	#workingVisible = defaultWorkingVisible;
	#hiddenThinkingLabel: string | undefined;
	#toolsExpanded = false;
	#footerMounted = false;
	#headerMounted = false;
	#editorComponentFactory: EditorFactory | undefined;

	constructor(
		private readonly store: AppStore,
		private readonly hooks: ExtensionUiControllerHooks = {},
	) {
		this.#terminalSurfaces = new TerminalSurfaceController({
			onUpdate: (surfaces) => this.store.setTerminalSurfaces([...surfaces]),
			// Round 6 F2 — see `TerminalSurfaceControllerOptions.viewportHint`'s doc comment.
			viewportHint: () => this.store.clientViewportCells,
		});
	}

	/**
	 * `runtimeKey` identifies which runtime this context belongs to — used
	 * to find or create that runtime's own PIUI element store. It must be
	 * the same object every time the same runtime's context is (re)built.
	 */
	context(
		isActive: () => boolean,
		runtimeKey: AgentSessionRuntime,
	): ExtensionUIContext {
		// A new context means the SDK is about to (re)bind this runtime's
		// extensions and re-run `session_start`, which registers their
		// listeners again: drop the previous binding's so none is doubled.
		this.#terminalInputHandlers.delete(runtimeKey);
		if (this.#inputRuntime === runtimeKey) this.syncTerminalInputActive();
		return {
			select: (title, options, dialogOptions) =>
				this.select(isActive, title, options, dialogOptions),
			confirm: (title, message, dialogOptions) =>
				this.confirm(isActive, title, message, dialogOptions),
			input: (title, placeholder, dialogOptions) =>
				this.input(isActive, title, placeholder, dialogOptions),
			notify: (message, type = "info") =>
				this.notify(isActive, runtimeKey, message, type),
			onTerminalInput: (handler) => {
				// Registered even while inactive (e.g. `session_start` of a
				// replacement runtime bound before it is adopted): routing only
				// ever reads the foreground runtime's own set.
				let handlers = this.#terminalInputHandlers.get(runtimeKey);
				if (!handlers) {
					handlers = new Set();
					this.#terminalInputHandlers.set(runtimeKey, handlers);
				}
				const owned = handlers;
				owned.add(handler);
				if (isActive()) this.#inputRuntime = runtimeKey;
				this.syncTerminalInputActive();
				return () => {
					owned.delete(handler);
					this.syncTerminalInputActive();
				};
			},
			setStatus: (key, text) => {
				if (!isActive()) return;
				if (text === undefined) this.#statuses.delete(key);
				else this.#statuses.set(key, text);
				this.store.setExtensionStatuses(
					this.#statuses
						.entries()
						.map(([key, text]) => ({ key, text }))
						.toArray(),
				);
			},
			setWorkingMessage: (message) => {
				if (!isActive()) return;
				this.#workingMessage = message;
				this.syncWorking();
			},
			setWorkingVisible: (visible) => {
				if (!isActive()) return;
				this.#workingVisible = visible;
				this.syncWorking();
			},
			setWorkingIndicator: (options) => {
				if (!isActive()) return;
				this.#workingIndicator = normalizeWorkingIndicator(options);
				this.syncWorking();
			},
			setHiddenThinkingLabel: (label) => {
				if (!isActive()) return;
				this.#hiddenThinkingLabel = label;
			},
			setWidget: (key, content, options) => {
				if (!isActive()) return;
				if (content === undefined) {
					this.#widgets.delete(key);
					if (this.#componentWidgetKeys.delete(key)) {
						this.#terminalSurfaces.dispose(widgetSurfaceId(key));
					}
				} else if (Array.isArray(content)) {
					if (this.#componentWidgetKeys.delete(key)) {
						this.#terminalSurfaces.dispose(widgetSurfaceId(key));
					}
					this.#widgets.set(key, {
						key,
						lines: [...content],
						placement: options?.placement ?? "aboveEditor",
					});
				} else {
					// A `(tui, theme) => Component` factory: mount it as a persistent
					// terminal surface, and drop any prior string-line rendering under
					// the same key, matching "this key is now a component-only widget".
					this.#widgets.delete(key);
					this.#componentWidgetKeys.add(key);
					this.#terminalSurfaces.mountPersistent({
						id: widgetSurfaceId(key),
						kind: "widget",
						factory: content,
						colorScheme: this.colorScheme(),
						belowEditor: options?.placement === "belowEditor",
					});
				}
				this.store.setExtensionWidgets(this.#widgets.values().toArray());
			},
			setFooter: (factory) => {
				if (!isActive()) return;
				if (!factory) {
					if (this.#footerMounted)
						this.#terminalSurfaces.dispose(footerSurfaceId);
					this.#footerMounted = false;
					return;
				}
				this.#footerMounted = true;
				this.#terminalSurfaces.mountPersistent({
					id: footerSurfaceId,
					kind: "footer",
					factory,
					footerData: this.#footerData(),
					colorScheme: this.colorScheme(),
				});
			},
			setHeader: (factory) => {
				if (!isActive()) return;
				if (!factory) {
					if (this.#headerMounted)
						this.#terminalSurfaces.dispose(headerSurfaceId);
					this.#headerMounted = false;
					return;
				}
				this.#headerMounted = true;
				this.#terminalSurfaces.mountPersistent({
					id: headerSurfaceId,
					kind: "header",
					factory,
					colorScheme: this.colorScheme(),
				});
			},
			setTitle: (title) => {
				if (isActive()) this.store.setDocumentTitle(title);
			},
			custom: <T>(factory: CustomComponentFactory<T>, options: CustomOptions) =>
				this.custom<T>(isActive, factory, options),
			pasteToEditor: (text) => {
				if (!isActive()) return;
				this.setEditorText(`${this.store.promptEditorText}${text}`);
			},
			setEditorText: (text) => {
				if (isActive()) this.setEditorText(text);
			},
			getEditorText: () => (isActive() ? this.store.promptEditorText : ""),
			editor: (title, prefill) => this.editor(isActive, title, prefill),
			addAutocompleteProvider: (factory) => {
				if (isActive()) this.#autocompleteProviders.push(factory);
			},
			setEditorComponent: (factory) => {
				if (isActive()) this.#editorComponentFactory = factory;
			},
			getEditorComponent: () => this.#editorComponentFactory,
			theme: identityTheme,
			getAllThemes: () => [],
			getTheme: () => undefined,
			setTheme: () => ({
				success: false,
				error: "TUI themes are unavailable in pi-ui",
			}),
			getToolsExpanded: () => this.#toolsExpanded,
			setToolsExpanded: (expanded) => {
				if (isActive()) this.#toolsExpanded = expanded;
			},
		};
	}

	/**
	 * The label an extension asked to hide reasoning/thinking blocks behind.
	 * Recorded (never rendered) for Round 2's terminal-surface host to read.
	 */
	getHiddenThinkingLabel(): string | undefined {
		return this.#hiddenThinkingLabel;
	}

	/**
	 * Runs every registered `ctx.ui.onTerminalInput` listener over `data`, in
	 * registration order, exactly like the real TUI's raw `inputListeners`
	 * pipeline (`pi-tui`'s `TUI.handleTerminalInput`): each listener sees
	 * whatever the previous one's `{data}` rewrote, and the first `{consume:
	 * true}` short-circuits the rest. A listener that throws is reported and
	 * skipped (never rewrites `data`), the same recovery
	 * `handleTerminalSurfaceInput`/`handlePromptLevelInput` always had.
	 */
	#runTerminalInputHandlers(data: string): TerminalInputRoutingResult {
		let forwarded = data;
		// A snapshot: a listener may unsubscribe itself (or another) mid-dispatch.
		for (const handler of Array.from(this.#activeTerminalInputHandlers())) {
			let result: ReturnType<TerminalInputHandler>;
			try {
				result = handler(forwarded);
			} catch (error) {
				console.error("Extension terminal input handler failed", error);
				continue;
			}
			if (result?.consume) return { consumed: true, data: forwarded };
			if (result?.data !== undefined) forwarded = result.data;
		}
		return { consumed: false, data: forwarded };
	}

	/**
	 * Routes a raw terminal byte sequence to a mounted surface. `ctx.ui.onTerminalInput`
	 * listeners see it first, like the TUI's input pipeline: one may rewrite the data or
	 * consume it. `false` if `id` is unknown.
	 */
	handleTerminalSurfaceInput(id: string, data: string): boolean {
		const { consumed, data: forwarded } = this.#runTerminalInputHandlers(data);
		if (consumed) return true;
		return this.#terminalSurfaces.handleInput(id, forwarded);
	}

	/**
	 * Routes a key typed at the prompt (nothing focused a terminal surface) to
	 * every registered `ctx.ui.onTerminalInput` listener — real interactive-mode's
	 * raw `inputListeners` see every keystroke before *any* component gets
	 * focus dispatch, which is how `bash-background.ts`/`subagents.ts`'s
	 * manage-mode arrows/`j`/`k`/`x`/Escape reach them without a mounted
	 * surface of their own (F1 §2). The client (`static/app/extension-keys.ts`)
	 * only calls this while `AppStore.extensionTerminalInputActive` is true,
	 * and only forwards a bounded set of "candidate" keys (arrows/Escape/a
	 * single unmodified character while the prompt is empty) so ordinary
	 * typing never pays a round trip — see that module's doc comment for the
	 * full precedence rationale. Unlike `handleTerminalSurfaceInput`, there is
	 * no surface to fall back into: an unconsumed key is simply not consumed,
	 * and the client types it (or applies its own fallback, e.g. Escape)
	 * itself.
	 */
	handlePromptLevelInput(data: string): PromptLevelInputResult {
		return { consumed: this.#runTerminalInputHandlers(data).consumed };
	}

	/** Whether `handlePromptLevelInput` currently has anything to route to — see
	 * `AppStore.extensionTerminalInputActive`. */
	private syncTerminalInputActive(): void {
		this.store.setExtensionTerminalInputActive(
			this.#activeTerminalInputHandlers().size > 0,
		);
	}

	#activeTerminalInputHandlers(): ReadonlySet<TerminalInputHandler> {
		const runtime = this.#inputRuntime;
		return (runtime && this.#terminalInputHandlers.get(runtime)) || new Set();
	}

	/** Applies a client-measured grid resize to a mounted surface. `false` if `id` is unknown. */
	resizeTerminalSurface(
		id: string,
		cols: number,
		rows: number,
		clientId?: string,
	): boolean {
		return this.#terminalSurfaces.resize(id, { columns: cols, rows }, clientId);
	}

	/** Forgets one client's reported terminal-surface sizes once its connection closes —
	 * see `TerminalSurfaceController.forgetClient`. */
	forgetTerminalSurfaceClient(clientId: string): void {
		this.#terminalSurfaces.forgetClient(clientId);
	}

	/**
	 * Reconstructs the `${ns}:${id}` form a bridge-aware extension's
	 * `lib/bridge.ts` derives its namespace from (`elementId.split(":")[0]`)
	 * — see `pi_ui_event`'s `dispatchExtensionUiAction` caller. Looked up in
	 * `runtimeKey`'s own element store (the action always targets whichever
	 * runtime is currently foreground). A bare id the browser already sent
	 * prefixed (contains `:`), or one that store cannot uniquely resolve to
	 * a single namespace, is returned unprefixed.
	 */
	resolveElementId(id: string, runtimeKey: AgentSessionRuntime): string {
		if (id.includes(":")) return id;
		const ns = this.#piUiStores.get(runtimeKey)?.elements.findNamespace(id);
		return ns === undefined ? id : `${ns}:${id}`;
	}

	/**
	 * Republishes `runtimeKey`'s own PIUI elements (and, absent a channel
	 * owner hook, channels) into `AppStore` — call whenever that runtime
	 * becomes, or resumes being, the foreground one. Elements a backgrounded
	 * session received via `notify()` are kept in its own store the whole
	 * time (see `notify()`); this is what actually brings them back into
	 * view instead of leaving the foreground blank (A#23).
	 */
	restoreElements(runtimeKey: AgentSessionRuntime): void {
		// Same moment for `ctx.ui.onTerminalInput`: route this runtime's
		// listeners again (see `#terminalInputHandlers`).
		this.#inputRuntime = runtimeKey;
		this.syncTerminalInputActive();
		const runtimeStore = this.#piUiStores.get(runtimeKey);
		this.store.setExtensionElements(runtimeStore?.elements.elements() ?? []);
		if (!this.hooks.onChannel) {
			this.store.setExtensionChannels(runtimeStore?.elements.channels() ?? []);
		}
	}

	#piUiStoreFor(runtimeKey: AgentSessionRuntime): PiUiRuntimeStore {
		let runtimeStore = this.#piUiStores.get(runtimeKey);
		if (!runtimeStore) {
			runtimeStore = {
				decoder: new PiUiBridgeDecoder(),
				elements: new PiUiElementStore(),
			};
			this.#piUiStores.set(runtimeKey, runtimeStore);
		}
		return runtimeStore;
	}

	respond(id: string, value: string | undefined, cancelled: boolean): boolean {
		if (this.#active?.dialog.id !== id) return false;
		const active = this.#active;
		this.finish(active);
		active.respond(value, cancelled);
		this.showNext();
		return true;
	}

	/**
	 * Rejects every pending/active dialog (as a cancel) without touching any
	 * other extension UI state. A command handler that throws mid-dialog
	 * (e.g. after calling `select()` but before it resolves) otherwise
	 * leaves that dialog queued forever — nothing will ever call
	 * `respond()`/`abort()` for it — blocking every dialog queued behind it.
	 * `bindSessionExtensions()`'s `onError` calls this so the queue recovers
	 * from a throwing command.
	 */
	cancelPendingDialogs(): void {
		const pending = [this.#active, ...this.#queue].filter(
			(dialog): dialog is PendingDialog => dialog !== undefined,
		);
		this.#active = undefined;
		this.#queue.length = 0;
		for (const dialog of pending) {
			this.cleanup(dialog);
			dialog.respond(undefined, true);
		}
		this.store.setExtensionDialog(undefined);
	}

	cancelAll(): void {
		this.cancelPendingDialogs();
		this.#statuses.clear();
		this.#widgets.clear();
		this.#componentWidgetKeys.clear();
		// Not clearing the per-runtime listener sets, for the same reason as
		// `#piUiStores` below; the runtime just stops being routed to.
		this.#inputRuntime = undefined;
		this.syncTerminalInputActive();
		this.#autocompleteProviders.length = 0;
		// Deliberately NOT clearing `#piUiStores` here: this runs on every
		// unbind (including backgrounding a session), and a per-runtime PIUI
		// element store must survive that so `restoreElements()` has
		// something to bring back on re-foreground (A#23). A genuinely
		// disposed runtime's entry becomes collectable on its own once
		// nothing else references it.
		this.#workingIndicator = undefined;
		this.#workingMessage = undefined;
		this.#workingVisible = defaultWorkingVisible;
		this.#hiddenThinkingLabel = undefined;
		this.#toolsExpanded = false;
		this.#footerMounted = false;
		this.#headerMounted = false;
		this.#editorComponentFactory = undefined;
		// Disposes every mounted `custom()`/widget/footer/header surface, resolving
		// any outstanding `custom()` promise with `undefined` rather than leaving it
		// pending forever (background isolation: a surface never outlives its session).
		this.#terminalSurfaces.disposeAll();
		this.store.setExtensionDialog(undefined);
		this.store.setExtensionStatuses([]);
		this.store.setExtensionWidgets([]);
		this.store.setExtensionElements([]);
		// With an `onChannel` owner, channels are cleared by that owner on session switch.
		if (!this.hooks.onChannel) this.store.setExtensionChannels([]);
		this.syncWorking();
		this.store.setDocumentTitle("pi-ui");
	}

	private notify(
		isActive: () => boolean,
		runtimeKey: AgentSessionRuntime,
		message: string,
		type: "info" | "warning" | "error",
	): void {
		if (PiUiBridgeDecoder.isPiUiMessage(message)) {
			// Bridge-aware extensions (see `~/.pi/agent/extensions/lib/bridge.ts`)
			// speak the "Pi UI Bridge" (PIUI) protocol over this same fire-and-
			// forget `notify()` channel whenever they detect a live RPC-mode
			// client — which pi-ui always is. These payloads are structured
			// element updates, never user-facing text, so they must NEVER reach
			// the transcript as a notice, whether or not they decode cleanly.
			const runtimeStore = this.#piUiStoreFor(runtimeKey);
			const op = runtimeStore.decoder.decode(message);
			if (!op) return;
			if (op.op === "channel" && this.hooks.onChannel) {
				// Channels route to a single shared owner (e.g. LiveWorkspaceController)
				// and are not restored per-runtime like elements — only forwarded
				// while this runtime is the foreground one, as before.
				if (isActive()) this.hooks.onChannel(op.channel, op.payload);
				return;
			}
			// Applied to the OWNING runtime's own store regardless of whether it
			// is currently foreground, so a backgrounded session's elements are
			// never lost — only whether they're published to `AppStore` depends
			// on being foreground; `restoreElements()` republishes them on
			// re-foreground (A#23).
			runtimeStore.elements.apply(op);
			if (!isActive()) return;
			if (op.op === "channel") {
				this.store.setExtensionChannels(runtimeStore.elements.channels());
			} else {
				this.store.setExtensionElements(runtimeStore.elements.elements());
			}
			return;
		}
		if (!isActive()) return;
		// Each level gets its own status-dot color and screen-reader prefix in the
		// transcript (renderSystemMessage) instead of every notice reading
		// "Warning: …" regardless of severity — see r1-audit #24.
		// Extensions written for the TUI often style notices with ANSI SGR codes (e.g. pi-rtk's
		// status line); the transcript renders plain text, so drop the escapes instead of
		// showing them as raw control characters.
		this.store.appendMessage("notice", stripAnsi(message), { noticeTone: type });
	}

	private select(
		isActive: () => boolean,
		title: string,
		options: string[],
		dialogOptions?: ExtensionUIDialogOptions,
	): Promise<string | undefined> {
		if (!isActive()) return Promise.resolve(undefined);
		const { promise, resolve } = Promise.withResolvers<string | undefined>();
		this.enqueue(
			{
				dialog: {
					id: crypto.randomUUID(),
					kind: "select",
					title,
					options: [...options],
					// Some extensions (e.g. compact-pct) already include their own "Cancel"
					// row among `options`; suppress pi-ui's own generic one so the list
					// doesn't show two (round-2 audit m8).
					hasOwnCancel: options.some(
						(option) => option.trim().toLowerCase() === "cancel",
					),
				},
				respond: (value, cancelled) =>
					resolve(
						!cancelled && value !== undefined && options.includes(value)
							? value
							: undefined,
					),
			},
			dialogOptions,
		);
		return promise;
	}

	private confirm(
		isActive: () => boolean,
		title: string,
		message: string,
		dialogOptions?: ExtensionUIDialogOptions,
	): Promise<boolean> {
		if (!isActive()) return Promise.resolve(false);
		const { promise, resolve } = Promise.withResolvers<boolean>();
		this.enqueue(
			{
				dialog: { id: crypto.randomUUID(), kind: "confirm", title, message },
				respond: (value, cancelled) => resolve(!cancelled && value === "confirm"),
			},
			dialogOptions,
		);
		return promise;
	}

	private input(
		isActive: () => boolean,
		title: string,
		placeholder?: string,
		dialogOptions?: ExtensionUIDialogOptions,
	): Promise<string | undefined> {
		return this.textDialog(
			isActive,
			{
				id: crypto.randomUUID(),
				kind: "input",
				title,
				// Some extensions (e.g. /goal draft) pass the same string for both the
				// dialog's heading and its placeholder; showing it twice reads as broken —
				// the heading already says it, so drop a placeholder that only repeats it
				// (round-2 audit m8).
				placeholder: placeholder === title ? undefined : placeholder,
			},
			dialogOptions,
		);
	}

	/**
	 * Mounts a `custom()` overlay/inline component as a terminal surface (see
	 * `TerminalSurfaceController.mountCustom`). Never throws or rejects —
	 * resolves `undefined` for an inactive session (matching every other
	 * `isActive()`-gated method here) and for any internal failure, so a
	 * command handler that `await`s `custom()` always completes.
	 */
	private custom<T>(
		isActive: () => boolean,
		factory: CustomComponentFactory<T>,
		options: CustomOptions,
	): Promise<T> {
		if (!isActive()) {
			// SAFETY: every other `isActive()`-gated method here resolves/
			// returns its "inactive session" default without a real `T` to
			// offer (see the class-level comment on `identityTheme`'s traps);
			// `custom()`'s caller already treats `undefined` as a valid
			// resolution regardless of `T`.
			return Promise.resolve(undefined as T);
		}
		const release = this.hooks.onCustomPrompt?.(!isNonCapturingOverlay(options));
		return this.#terminalSurfaces
			.mountCustom<T>({
				id: crypto.randomUUID(),
				factory,
				overlay: options?.overlay ?? false,
				overlayOptions: options?.overlayOptions,
				onHandle: options?.onHandle,
				colorScheme: this.colorScheme(),
			})
			.finally(() => release?.())
			.catch((error) => {
				// `mountCustom` itself never rejects (it catches the factory's
				// own failures); this only guards synchronous throws before its
				// first `await` (e.g. a malformed `Theme`), so `custom()` keeps
				// the same "never throw into the extension" contract as every
				// other method here.
				console.error("Terminal surface custom() failed", error);
				// SAFETY: matches the "inactive session" branch above — no real
				// `T` exists for a failed mount, so `undefined` is the
				// intentional resolution.
				return undefined as T;
			});
	}

	/**
	 * The `hooks.colorScheme` override exists for callers that already track this some other
	 * way (and for tests); the normal path is `AppStore.clientColorScheme`, reported by the
	 * browser itself once per connection and on change — see `pi-ui-elements.tsx`'s
	 * `renderPiUiSheets` mount script and `POST /extensions/ui/color-scheme` — which is a real
	 * signal rather than the previous permanent `"dark"` default (round-2 audit m9).
	 */
	private colorScheme(): TerminalSurfaceColorScheme {
		return this.hooks.colorScheme?.() ?? this.store.clientColorScheme;
	}

	/** A minimal `ReadonlyFooterDataProvider` backed by this controller's own status map. */
	#footerData(): ReadonlyFooterDataProvider {
		return {
			getGitBranch: () => null,
			getExtensionStatuses: () => new Map(this.#statuses),
			getAvailableProviderCount: () => 0,
			onBranchChange: () => () => {},
		};
	}

	private editor(
		isActive: () => boolean,
		title: string,
		prefill?: string,
	): Promise<string | undefined> {
		return this.textDialog(isActive, {
			id: crypto.randomUUID(),
			kind: "editor",
			title,
			prefill,
		});
	}

	private textDialog(
		isActive: () => boolean,
		dialog: Extract<AppExtensionDialog, { kind: "input" | "editor" }>,
		dialogOptions?: ExtensionUIDialogOptions,
	): Promise<string | undefined> {
		if (!isActive()) return Promise.resolve(undefined);
		const { promise, resolve } = Promise.withResolvers<string | undefined>();
		this.enqueue(
			{
				dialog,
				respond: (value, cancelled) =>
					resolve(cancelled ? undefined : (value ?? "")),
			},
			dialogOptions,
		);
		return promise;
	}

	private enqueue(
		pending: PendingDialog,
		options: ExtensionUIDialogOptions | undefined,
	): void {
		if (options?.signal?.aborted) {
			pending.respond(undefined, true);
			return;
		}
		pending.signal = options?.signal;
		if (pending.signal) {
			pending.abort = () => this.abort(pending);
			pending.signal.addEventListener("abort", pending.abort, { once: true });
		}
		if (options?.timeout !== undefined) {
			pending.timer = setTimeout(() => this.abort(pending), options.timeout);
		}
		this.#queue.push(pending);
		this.showNext();
	}

	private showNext(): void {
		if (this.#active) return;
		this.#active = this.#queue.shift();
		this.store.setExtensionDialog(this.#active?.dialog);
	}

	private abort(pending: PendingDialog): void {
		if (pending === this.#active) {
			this.finish(pending);
			pending.respond(undefined, true);
			this.showNext();
			return;
		}
		const index = this.#queue.indexOf(pending);
		if (index < 0) return;
		this.#queue.splice(index, 1);
		this.cleanup(pending);
		pending.respond(undefined, true);
	}

	private finish(pending: PendingDialog): void {
		this.cleanup(pending);
		this.#active = undefined;
		this.store.setExtensionDialog(undefined);
	}

	private cleanup(pending: PendingDialog): void {
		if (pending.timer !== undefined) clearTimeout(pending.timer);
		if (pending.signal && pending.abort) {
			pending.signal.removeEventListener("abort", pending.abort);
		}
	}

	private setEditorText(text: string): void {
		this.store.setPromptEditorText(text);
	}

	private syncWorking(): void {
		this.store.setExtensionWorking({
			message: this.#workingMessage,
			visible: this.#workingVisible,
			indicator: this.#workingIndicator,
		});
	}
}

function normalizeWorkingIndicator(
	options: WorkingIndicatorOptions | undefined,
): AppExtensionWorkingIndicator | undefined {
	if (!options?.frames) return undefined;
	return { frames: [...options.frames], intervalMs: options.intervalMs };
}

/** Stable terminal-surface id for a `setWidget(key, (tui, theme) => Component)` mount. */
function widgetSurfaceId(key: string): string {
	return `widget:${key}`;
}

const footerSurfaceId = "footer";
const headerSurfaceId = "header";

/** A `custom()` overlay shown with `nonCapturing` (static or from an options factory). */
function isNonCapturingOverlay(options: CustomOptions): boolean {
	return (
		options?.overlay === true &&
		resolveOverlayOptions(options.overlayOptions)?.nonCapturing === true
	);
}
