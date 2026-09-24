import {
	isFocusable,
	isKeyRelease,
	StdinBuffer,
	type Component,
	type OverlayAnchor,
	type OverlayBounds,
	type OverlayHandle,
	type OverlayOptions,
	type OverlayUnfocusOptions,
	type RgbColor,
	type TerminalColorScheme,
	type TUI,
	type TuiInputListener,
	type TuiMode,
	type TuiStopOptions,
} from "@earendil-works/pi-tui";

import { isNumber, isString } from "../../utils/type-guards.ts";
import type { HeadlessTerminal } from "./headless-terminal.ts";

type OverlayEntry = {
	readonly component: Component;
	options: OverlayOptions | undefined;
	hidden: boolean;
	focusOrder: number;
	bounds: OverlayBounds | undefined;
};

export type TuiShimCallbacks = {
	/** A component asked to be re-rendered; `force` requests an immediate (non-coalesced) frame. */
	requestRender(force: boolean): void;
};

/**
 * A from-scratch implementation of `pi-tui`'s `TUI` surface — not a
 * `TuiBase` subclass, because `TuiBase`'s differential-render/overlay-
 * compositing internals assume a single shared terminal screen behind
 * everything it mounts (chat transcript, editor, footer, …), which has no
 * equivalent here: each `TerminalSurface` hosts exactly one extension-
 * authored `custom()`/widget/footer/header component in its own browser
 * dialog or pane, so there is no "base screen" to composite an overlay over.
 * What extensions actually rely on — `requestRender`, `showOverlay`/
 * `hideOverlay`/`hasOverlay` for a component's own nested sub-dialogs,
 * `setFocus`, `addInputListener` — is reimplemented directly against a
 * `HeadlessTerminal`, scoped to a single surface's component tree.
 *
 * Overlay nesting is simplified accordingly: only the topmost visible
 * overlay is ever rendered (real pi-tui composites every visible overlay
 * over the base screen at its anchored position). For the common case this
 * is built for — a `custom()` factory that itself pushes a modal sub-dialog
 * (e.g. a confirm prompt over a `SelectList`) — the topmost overlay is also
 * the only one that receives focus and input, so this loses only the visual
 * "peek behind" of the covered layer, not functionality.
 */
export class TuiShim implements TUI {
	readonly mode: TuiMode = "regular";
	children: Component[] = [];
	onDebug?: () => void;

	#overlays: OverlayEntry[] = [];
	#focusOrderCounter = 0;
	#focused: Component | null = null;
	#showHardwareCursor = true;
	#clearOnShrink = false;
	#inputListeners = new Set<TuiInputListener>();
	#lastOverlayWidth = 0;
	/** Splits batched client input into single key sequences, as pi-tui's own terminal does. */
	#stdin = new StdinBuffer();

	constructor(
		public terminal: HeadlessTerminal,
		private readonly callbacks: TuiShimCallbacks,
	) {
		this.#stdin.on("data", (sequence) => this.#dispatchInput(sequence));
		this.#stdin.on("paste", (content) =>
			this.#dispatchInput(`\x1b[200~${content}\x1b[201~`),
		);
	}

	get fullRedraws(): number {
		return 0;
	}

	addChild(component: Component): void {
		this.children.push(component);
	}

	removeChild(component: Component): void {
		const index = this.children.indexOf(component);
		if (index !== -1) this.children.splice(index, 1);
	}

	clear(): void {
		this.children = [];
	}

	invalidate(): void {
		for (const child of this.children) child.invalidate();
		for (const overlay of this.#overlays) overlay.component.invalidate();
	}

	getShowHardwareCursor(): boolean {
		return this.#showHardwareCursor;
	}

	setShowHardwareCursor(enabled: boolean): void {
		this.#showHardwareCursor = enabled;
	}

	getClearOnShrink(): boolean {
		return this.#clearOnShrink;
	}

	setClearOnShrink(enabled: boolean): void {
		this.#clearOnShrink = enabled;
	}

	setFocus(component: Component | null): void {
		if (component === this.#focused) return;
		if (this.#focused && isFocusable(this.#focused)) this.#focused.focused = false;
		this.#focused = component;
		if (component && isFocusable(component)) component.focused = true;
	}

	getFocusedComponent(): Component | null {
		return this.#focused;
	}

	showOverlay(component: Component, options?: OverlayOptions): OverlayHandle {
		const entry: OverlayEntry = {
			component,
			options,
			hidden: false,
			focusOrder: ++this.#focusOrderCounter,
			bounds: undefined,
		};
		this.#overlays.push(entry);
		if (!options?.nonCapturing) this.setFocus(component);
		this.callbacks.requestRender(false);
		return this.#handleFor(entry);
	}

	/** Hides (removes) the topmost overlay and restores focus to the next one, if any. */
	hideOverlay(): void {
		const topmost = this.#topmostEntry();
		if (!topmost) return;
		this.#remove(topmost);
	}

	hasOverlay(): boolean {
		return this.#overlays.some((entry) => !entry.hidden);
	}

	start(): void {
		this.terminal.start(
			(data) => this.handleInput(data),
			() => this.requestRender(),
		);
	}

	stop(_options?: TuiStopOptions): void {
		this.#stdin.destroy();
		this.terminal.stop();
	}

	renderNow(_force?: boolean): void {
		this.callbacks.requestRender(true);
	}

	requestRender(_force?: boolean): void {
		this.callbacks.requestRender(false);
	}

	addInputListener(listener: TuiInputListener): () => void {
		this.#inputListeners.add(listener);
		return () => {
			this.#inputListeners.delete(listener);
		};
	}

	removeInputListener(listener: TuiInputListener): void {
		this.#inputListeners.delete(listener);
	}

	onTerminalColorSchemeChange(
		_listener: (scheme: TerminalColorScheme) => void,
	): () => void {
		// No real terminal to report a color-scheme change from; the client
		// already tells the server its light/dark preference out of band (the
		// `Theme` a surface is mounted with is resolved from that up front).
		return () => {};
	}

	setTerminalColorSchemeNotifications(_enabled: boolean): void {}

	async queryTerminalBackgroundColor(): Promise<RgbColor | undefined> {
		return undefined;
	}

	async queryTerminalColorScheme(): Promise<TerminalColorScheme | undefined> {
		return undefined;
	}

	/** Renders the topmost visible overlay if any, else the mounted root children, stacked. */
	render(width: number): string[] {
		const topmost = this.#topmostVisible();
		if (topmost) {
			const resolved = this.#resolveOverlayWidth(topmost.options, width);
			this.#lastOverlayWidth = resolved;
			const lines = topmost.component.render(resolved);
			topmost.bounds = { row: 0, col: 0, width: resolved, height: lines.length };
			return lines;
		}
		const lines: string[] = [];
		for (const child of this.children) lines.push(...child.render(width));
		return lines;
	}

	/** Width the topmost overlay was last rendered at — used to size the surrounding dialog. */
	get lastOverlayWidth(): number {
		return this.#lastOverlayWidth;
	}

	/**
	 * Routes raw client input. The browser always sends complete sequences, so
	 * anything the buffer still holds (a lone Esc awaiting a possible Alt+key
	 * continuation) is flushed immediately instead of on a timer.
	 */
	handleInput(data: string): void {
		this.#stdin.process(data);
		for (const sequence of this.#stdin.flush()) this.#dispatchInput(sequence);
	}

	/** Dispatches one key sequence: input listeners first, then the focused component. */
	#dispatchInput(data: string): void {
		let current = data;
		for (const listener of this.#inputListeners) {
			const result = listener(current);
			if (result?.consume) return;
			if (result?.data !== undefined) current = result.data;
		}
		if (current.length === 0) return;
		const target =
			this.#focused ?? this.#topmostVisible()?.component ?? this.children.at(-1);
		if (!target?.handleInput) return;
		if (isKeyRelease(current) && !target.wantsKeyRelease) return;
		target.handleInput(current);
		// Like pi-tui's `TUI.handleInput`: components mutate state on input without asking
		// for a render themselves, so the host renders after every dispatched key.
		this.callbacks.requestRender(true);
	}

	#resolveOverlayWidth(
		options: OverlayOptions | undefined,
		surfaceWidth: number,
	): number {
		// Mirrors pi-tui's `TUI.resolveOverlayLayout`: `width` in columns or a percentage of
		// the terminal, else `min(80, available)`; then `minWidth`; then clamped to the space
		// left after horizontal margins.
		const margin = options?.margin;
		const marginLeft = Math.max(0, (isNumber(margin) ? margin : margin?.left) ?? 0);
		const marginRight = Math.max(0, (isNumber(margin) ? margin : margin?.right) ?? 0);
		const available = Math.max(1, surfaceWidth - marginLeft - marginRight);
		const value = options?.width;
		let width = Math.min(80, available);
		if (isNumber(value)) width = value;
		else if (isString(value)) {
			const match = /^(\d+(?:\.\d+)?)%$/.exec(value);
			if (match?.[1])
				width = Math.floor((surfaceWidth * Number.parseFloat(match[1])) / 100);
		}
		if (options?.minWidth !== undefined) width = Math.max(width, options.minWidth);
		return Math.max(1, Math.min(width, available));
	}

	#topmostEntry(): OverlayEntry | undefined {
		return this.#overlays.at(-1);
	}

	#topmostVisible(): OverlayEntry | undefined {
		for (let index = this.#overlays.length - 1; index >= 0; index -= 1) {
			const entry = this.#overlays[index];
			if (entry && !entry.hidden) return entry;
		}
		return undefined;
	}

	#remove(entry: OverlayEntry): void {
		const index = this.#overlays.indexOf(entry);
		if (index !== -1) this.#overlays.splice(index, 1);
		if (this.#focused === entry.component) {
			const next = this.#topmostVisible();
			this.setFocus(next?.component ?? null);
		}
		this.callbacks.requestRender(false);
	}

	#handleFor(entry: OverlayEntry): OverlayHandle {
		return {
			hide: () => this.#remove(entry),
			setHidden: (hidden: boolean) => {
				if (entry.hidden === hidden) return;
				entry.hidden = hidden;
				if (hidden && this.#focused === entry.component) {
					const next = this.#topmostVisible();
					this.setFocus(next?.component ?? null);
				}
				this.callbacks.requestRender(false);
			},
			isHidden: () => entry.hidden,
			focus: () => {
				entry.focusOrder = ++this.#focusOrderCounter;
				entry.hidden = false;
				this.setFocus(entry.component);
				this.callbacks.requestRender(false);
			},
			unfocus: (options?: OverlayUnfocusOptions) => {
				if (this.#focused !== entry.component) return;
				const fallback =
					options?.target ?? this.#topmostVisible()?.component ?? null;
				this.setFocus(fallback === entry.component ? null : fallback);
				this.callbacks.requestRender(false);
			},
			isFocused: () => this.#focused === entry.component,
			getBounds: () => entry.bounds,
		};
	}
}

/** Re-exported for callers that only need the anchor type without importing `pi-tui` directly. */
export type { OverlayAnchor, OverlayOptions };
