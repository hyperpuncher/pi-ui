import type {
	KeybindingsManager,
	ReadonlyFooterDataProvider,
	Theme,
} from "@earendil-works/pi-coding-agent";
import {
	type Component,
	KeybindingsManager as TuiKeybindingsManager,
	type OverlayHandle,
	type OverlayOptions,
	TUI_KEYBINDINGS,
	type TUI,
} from "@earendil-works/pi-tui";

import { StreamingFrameScheduler } from "../../state/streaming-frame-scheduler.ts";
import { isNumber, isString } from "../../utils/type-guards.ts";
import { ansiLineToHtml } from "./ansi-to-html.ts";
import {
	clampTerminalSize,
	defaultTerminalColumns,
	defaultTerminalRows,
	HeadlessTerminal,
} from "./headless-terminal.ts";
import { resolveTerminalTheme, type TerminalSurfaceColorScheme } from "./theme.ts";
import { TuiShim } from "./tui-shim.ts";
import {
	maxTerminalSurfaceLineLength,
	maxTerminalSurfaceLines,
	type TerminalSurface,
	type TerminalSurfaceKind,
	type TerminalSurfaceOverlayOptions,
} from "./types.ts";

/** Coalesced render rate for every terminal surface (see the Round 2 plan: "≤30fps"). */
const surfaceFrameHz = 30;

/** Passed to `setWidget`/`setHeader` factories, which declare but never read a 3rd argument. */
const noopFooterData: ReadonlyFooterDataProvider = {
	getGitBranch: () => null,
	getExtensionStatuses: () => new Map(),
	getAvailableProviderCount: () => 0,
	onBranchChange: () => () => {},
};

export type DisposableComponent = Component & { dispose?(): void };

export type CustomComponentFactory<T> = (
	tui: TUI,
	theme: Theme,
	keybindings: KeybindingsManager,
	done: (result: T) => void,
) => DisposableComponent | Promise<DisposableComponent>;

/**
 * Covers both `setWidget`/`setHeader` (2-arg) and `setFooter` (3-arg, with a
 * `ReadonlyFooterDataProvider`) factories — a wider parameter list than a
 * caller declares is always assignable to a narrower one, so this one type
 * fits all three `ExtensionUIContext` members without three near-identical
 * aliases.
 */
export type PersistentComponentFactory = (
	tui: TUI,
	theme: Theme,
	footerData: ReadonlyFooterDataProvider,
) => DisposableComponent;

export type MountCustomParams<T> = {
	readonly id: string;
	readonly factory: CustomComponentFactory<T>;
	readonly overlay: boolean;
	readonly overlayOptions?: OverlayOptions | (() => OverlayOptions);
	readonly onHandle?: (handle: OverlayHandle) => void;
	readonly colorScheme: TerminalSurfaceColorScheme;
	readonly title?: string;
	readonly cols?: number;
	readonly rows?: number;
};

export type MountPersistentParams = {
	readonly id: string;
	readonly kind: "widget" | "footer" | "header";
	readonly factory: PersistentComponentFactory;
	/** Only meaningful for `kind: "footer"`; ignored by widget/header factories. */
	readonly footerData?: ReadonlyFooterDataProvider;
	readonly colorScheme: TerminalSurfaceColorScheme;
	readonly title?: string;
	readonly cols?: number;
	readonly rows?: number;
	/**
	 * Mirrors the TUI, where `setFooter` always sits below the editor and `setHeader` above
	 * it; a `setWidget` component factory takes its placement from the same
	 * `{ placement: "aboveEditor" | "belowEditor" }` option the string-line form honours (M3).
	 */
	readonly belowEditor?: boolean;
};

type Mount = {
	readonly id: string;
	readonly kind: TerminalSurfaceKind;
	readonly terminal: HeadlessTerminal;
	readonly tui: TuiShim;
	readonly scheduler: StreamingFrameScheduler<true>;
	/** Raw (unconverted) overlay options resolver — kept raw so `visible()` can still be called. */
	readonly overlayOptionsResolver: (() => OverlayOptions | undefined) | undefined;
	readonly overlay: boolean;
	/** Mirrors `ExtensionUIContext.setWidget`'s `belowEditor`/`aboveEditor` option (M3). */
	readonly belowEditor: boolean;
	component: DisposableComponent | undefined;
	title: string | undefined;
	revision: number;
	disposed: boolean;
	/**
	 * Aborts the outstanding `custom()` promise (resolving it `undefined`);
	 * only set for `mountCustom` surfaces. A real `done(result)` resolution
	 * goes through `mountCustom`'s own closure instead of this field — `T`
	 * is erased on `Mount` (one map holds every surface's mount, whatever
	 * its `custom<T>()` type argument was), so this abort-only hook never
	 * needs to carry a result value.
	 */
	settle: (() => void) | undefined;
	/**
	 * Every client currently reporting a measured size for this surface, keyed by its display
	 * client id (R7-B item 1). Only populated for a non-overlay surface — a `custom()` inline,
	 * `setWidget`, `setFooter`/`setHeader` component all share one broadcast render
	 * (`DatastarClientHub` sends every connected tab the same HTML), so sizing from whichever
	 * tab's report `resize()` saw last let a narrower tab's box clip it (an open finding from
	 * the Round 6 audit). `resize()` renders at the narrowest of every currently-reporting
	 * client instead, so no tab that can display this surface ever gets a size wider than it can
	 * show. An overlay is exempt: it already converges to one size across tabs client-side
	 * (`percentOverlayReport` in `terminal-keys.js`), so `resize()` keeps writing it directly.
	 */
	readonly clientSizes: Map<string, { columns: number; rows: number }>;
};

/** `resize()`'s fallback key for a caller that reports no client id (an older client, a direct
 * test, or `#create`'s own initial seed) — one shared slot, matching pre-R7-B behavior exactly
 * when only one caller ever resizes a given surface. */
const legacyResizeClientKey = "__legacy_resize_client__";

/** The smallest column/row count any currently-reporting client asked for. Only ever called with
 * a non-empty map (see `resize()`/`forgetClient()`). */
function narrowestClientSize(
	sizes: ReadonlyMap<string, { columns: number; rows: number }>,
) {
	let columns = Number.POSITIVE_INFINITY;
	let rows = Number.POSITIVE_INFINITY;
	for (const size of sizes.values()) {
		columns = Math.min(columns, size.columns);
		rows = Math.min(rows, size.rows);
	}
	return { columns, rows };
}

export type TerminalSurfaceControllerOptions = {
	/** Called with the full current surface list after every coalesced frame commit or disposal. */
	onUpdate: (surfaces: readonly TerminalSurface[]) => void;
	/**
	 * The requesting client's last reported whole-viewport terminal-cell grid
	 * (`AppStore.clientViewportCells`, via `POST /extensions/terminal/viewport`
	 * — `static/app/terminal-keys.js`'s `reportViewportCells`), read fresh on
	 * every new surface rather than captured once, so it reflects the latest
	 * report even for a surface mounted well after this controller's own
	 * construction. Round 6 F2: `#create()` falls back to this instead of the
	 * fixed `defaultTerminalColumns`/`defaultTerminalRows` guess whenever a
	 * caller doesn't pass its own explicit `cols`/`rows`, so a percentage-width
	 * overlay's very first published frame is already close to its true size
	 * instead of visibly resizing once the surface's own resize report lands a
	 * round trip later. `undefined` (no report yet, or every reporting client
	 * has disconnected) keeps the previous fixed-default behavior exactly.
	 *
	 * R7-B items 2 & 3: `promptColumns` and `overlayPercentColumns`, when the reporting client
	 * sent them, replace that viewport-derived approximation with a real measurement — see
	 * `#create`'s use of each.
	 */
	viewportHint?: () => TerminalSurfaceViewportHint | undefined;
};

export type TerminalSurfaceViewportHint = {
	columns: number;
	rows: number;
	/**
	 * The client's own measured `#prompt-box` width, in cells — closer to a prompt-column
	 * surface's (inline/widget/footer/header) true first-frame size than the whole-viewport
	 * `columns` capped at the default ever was, since the prompt column's own padding/gutters
	 * aren't a fixed fraction of the viewport (a phone first-painted ~150ms of overflow from
	 * that gap — see `#create`). `undefined` from a client too old to report it, or before
	 * `#prompt-box` exists in the DOM — `#create` then falls back to `columns` capped at the
	 * default, exactly as before this round.
	 */
	promptColumns?: number;
	/**
	 * The width a percentage-width overlay's `N%` will resolve against once a real dialog's own
	 * fixed chrome is subtracted (mirrors `terminal-keys.js`'s `percentOverlayAvailableWidth`).
	 * The raw `columns` hint overshoots a percentage overlay's true settled size by that chrome
	 * (~5% at common widths), since it has no dialog to measure yet; `undefined` the same way
	 * `promptColumns` can be, in which case `#create` falls back to the raw `columns` hint.
	 */
	overlayPercentColumns?: number;
};

/**
 * Owns every headless `pi-tui` `TUI`/`Component` mount for one session (one
 * `TerminalSurfaceController` per `ExtensionUiController`, matching its
 * per-`RuntimeController` lifetime). Each surface — a `custom()` overlay or
 * inline replacement, a `setWidget` component, a `setFooter`/`setHeader`
 * component — gets its own `HeadlessTerminal` + `TuiShim` + coalesced
 * `StreamingFrameScheduler`, so one surface's high-frequency re-renders
 * (an animated spinner inside a `custom()` overlay) never starve another
 * surface's frames or the rest of the app's commit pipeline.
 */
export class TerminalSurfaceController {
	readonly #mounts = new Map<string, Mount>();
	readonly #snapshots = new Map<string, TerminalSurface>();
	/**
	 * `ExtensionUIContext.custom()`'s `keybindings` parameter is typed as
	 * pi-coding-agent's own `KeybindingsManager` subclass (adds `reload()`/
	 * `getEffectiveConfig()`/a private `configPath` over pi-tui's base
	 * class), but that subclass is only re-exported *type-only* from the
	 * package root — its `export declare class` lives under `core/
	 * keybindings.ts`, outside the package's public `exports` map, so it
	 * cannot be constructed here.
	 *
	 * SAFETY: pi-tui's real `KeybindingsManager` (which the exported type
	 * extends, adding only members no `Component` reads: `reload()`,
	 * `getEffectiveConfig()`, a private `configPath`) is constructed instead
	 * and asserted to the exported subtype; every extension-visible member
	 * of that subtype is inherited unchanged from this base class.
	 */
	readonly #keybindings = new TuiKeybindingsManager(
		TUI_KEYBINDINGS,
	) as KeybindingsManager;

	constructor(private readonly options: TerminalSurfaceControllerOptions) {}

	get keybindings(): KeybindingsManager {
		return this.#keybindings;
	}

	/**
	 * Mirrors real interactive-mode's `showExtensionCustom`: resolves the
	 * component from `factory`, then either shows it as an overlay or mounts
	 * it inline as this surface's sole root child. Resolves when `done()` is
	 * called (by the component itself, or by `dispose()`/`disposeAll()`
	 * externally) — never rejects, matching the "never throw into the
	 * extension" non-negotiable; a factory that throws or rejects resolves
	 * `undefined` instead.
	 */
	async mountCustom<T>(params: MountCustomParams<T>): Promise<T> {
		const { promise, resolve } = Promise.withResolvers<T>();
		let settled = false;
		const resolveWith = (result: T | undefined) => {
			if (settled) return;
			settled = true;
			// SAFETY: a `dispose()`-driven abort has no real `T` to offer and
			// intentionally resolves `undefined` regardless (see the doc
			// comment above and `Mount.settle`) — matching every other
			// `ExtensionUIContext` method's "never throw, resolve undefined
			// on abort" contract, even for a `T` that doesn't itself include
			// `undefined`.
			resolve(result as T);
		};
		const mount = this.#create({
			id: params.id,
			kind: params.overlay ? "overlay" : "inline",
			overlay: params.overlay,
			title: params.title,
			colorScheme: params.colorScheme,
			cols: params.cols,
			rows: params.rows,
			overlayOptionsResolver: params.overlayOptions
				? () => resolveOverlayOptions(params.overlayOptions)
				: undefined,
		});
		mount.settle = () => resolveWith(undefined);
		const theme = resolveTerminalTheme(params.colorScheme);
		const close = (result: T) => {
			if (settled) return;
			resolveWith(result);
			this.dispose(params.id);
		};
		let component: DisposableComponent;
		try {
			component = await params.factory(mount.tui, theme, this.#keybindings, close);
		} catch (error) {
			console.error(`Terminal surface "${params.id}" factory failed`, error);
			this.dispose(params.id);
			return promise;
		}
		if (settled) {
			// `close()`/`dispose()` already ran while the factory was still
			// resolving (e.g. session switch mid-await) — never mount a
			// component onto an already-torn-down surface.
			try {
				component.dispose?.();
			} catch {
				/* ignore dispose errors */
			}
			return promise;
		}
		mount.component = component;
		if (params.overlay) {
			const resolvedOptions = resolveOverlayOptions(params.overlayOptions);
			const handle = mount.tui.showOverlay(component, resolvedOptions);
			try {
				params.onHandle?.(handle);
			} catch (error) {
				console.error(`Terminal surface "${params.id}" onHandle failed`, error);
			}
		} else {
			mount.tui.addChild(component);
			mount.tui.setFocus(component);
		}
		this.#commitFrame(params.id);
		return promise;
	}

	/** Mounts (or replaces) a persistent, non-blocking surface: a widget/footer/header component. */
	mountPersistent(params: MountPersistentParams): void {
		this.dispose(params.id);
		const mount = this.#create({
			id: params.id,
			kind: params.kind,
			overlay: false,
			title: params.title,
			colorScheme: params.colorScheme,
			cols: params.cols,
			rows: params.rows,
			overlayOptionsResolver: undefined,
			// A footer always sits below the editor (matching the TUI); a header stays
			// above it; a widget takes its placement from the caller's option (M3).
			belowEditor: params.kind === "footer" || params.belowEditor === true,
		});
		const theme = resolveTerminalTheme(params.colorScheme);
		let component: DisposableComponent;
		try {
			component = params.factory(
				mount.tui,
				theme,
				params.footerData ?? noopFooterData,
			);
		} catch (error) {
			console.error(`Terminal surface "${params.id}" factory failed`, error);
			this.dispose(params.id);
			return;
		}
		mount.component = component;
		mount.tui.addChild(component);
		mount.tui.setFocus(component);
		this.#commitFrame(params.id);
	}

	/** Routes a raw terminal byte sequence (already client-encoded) to a surface. Returns `false` if unknown. */
	handleInput(id: string, data: string): boolean {
		const mount = this.#mounts.get(id);
		if (!mount || mount.disposed) return false;
		mount.tui.handleInput(data);
		return true;
	}

	/**
	 * Applies a client-measured grid resize. Returns `false` if the surface is unknown.
	 * `clientId` identifies the reporting tab (`AppStore`'s display client id) — for a
	 * non-overlay surface, `size` becomes just that client's own entry in `Mount.clientSizes`,
	 * and the mount renders at the narrowest entry across every client currently reporting one
	 * (R7-B item 1), never a size a connected tab reported as too small to show. An overlay
	 * keeps the pre-R7-B behavior of writing `size` straight through: it already converges to
	 * one shared size across tabs client-side (`percentOverlayReport`).
	 */
	resize(
		id: string,
		size: { columns: number; rows: number },
		clientId?: string,
	): boolean {
		const mount = this.#mounts.get(id);
		if (!mount || mount.disposed) return false;
		// The size is client-measured and untrusted; `setSize` clamps it (`clampTerminalSize`).
		if (mount.overlay) {
			mount.terminal.setSize(size);
			return true;
		}
		mount.clientSizes.set(clientId ?? legacyResizeClientKey, size);
		mount.terminal.setSize(narrowestClientSize(mount.clientSizes));
		return true;
	}

	/**
	 * Forgets one client's reported terminal-surface sizes once its SSE connection closes
	 * (mirrors `AppStore.clearClientViewportCells`), so a closed tab can't keep a persistent
	 * surface pinned to a size no tab still open actually needs. A surface with no client left
	 * reporting keeps its last known size, same as `clientViewportCells` falling back once every
	 * reporting client has disconnected.
	 */
	forgetClient(clientId: string): void {
		for (const mount of this.#mounts.values()) {
			if (mount.disposed || mount.overlay) continue;
			if (!mount.clientSizes.delete(clientId)) continue;
			if (mount.clientSizes.size === 0) continue;
			mount.terminal.setSize(narrowestClientSize(mount.clientSizes));
		}
	}

	/** Disposes one surface: stops its terminal, disposes its component, resolves any pending promise. */
	dispose(id: string): void {
		const mount = this.#mounts.get(id);
		if (!mount || mount.disposed) return;
		mount.disposed = true;
		mount.scheduler.clear();
		mount.tui.stop();
		try {
			mount.component?.dispose?.();
		} catch (error) {
			console.error(`Terminal surface "${id}" dispose() failed`, error);
		}
		mount.settle?.();
		this.#mounts.delete(id);
		this.#snapshots.delete(id);
		this.#publish();
	}

	/** Disposes every surface — session switch, reload, or runtime teardown. */
	disposeAll(): void {
		for (const id of this.#mounts.keys()) this.dispose(id);
	}

	snapshot(): TerminalSurface[] {
		return [...this.#snapshots.values()];
	}

	#create(params: {
		id: string;
		kind: TerminalSurfaceKind;
		overlay: boolean;
		title: string | undefined;
		colorScheme: TerminalSurfaceColorScheme;
		cols: number | undefined;
		rows: number | undefined;
		overlayOptionsResolver: (() => OverlayOptions | undefined) | undefined;
		belowEditor?: boolean;
	}): Mount {
		// Round 6 F2: an explicit `cols`/`rows` (rare — no current caller passes one) always
		// wins; otherwise seed from the client's last reported viewport (`viewportHint`) rather
		// than the fixed default, so a fresh surface's first frame is already close to its
		// true size instead of visibly resizing once its own resize report lands.
		const hint = this.options.viewportHint?.();
		let hintColumns = hint?.columns;
		if (hint) {
			if (params.overlay) {
				// No overlay can have more cells than the viewport less the dialog's own fixed
				// chrome (`overlayPercentColumns`, mirroring `percentOverlayAvailableWidth` in
				// `terminal-keys.js`), so that seeds every overlay when a client reported it. The
				// raw viewport hint overshot a percentage overlay by about 5% (R7-B item 3), and
				// let a fixed-width or unsized overlay (an MCP panel) first paint wider than a
				// phone sheet can show: 55px of overflow for ~150ms at 390px (R7 final audit).
				if (hint.overlayPercentColumns !== undefined) {
					hintColumns = hint.overlayPercentColumns;
				}
			} else {
				// The hint is the whole viewport, which only an overlay can span: an inline,
				// widget, header or footer surface sits in the narrower prompt column. R7-B item
				// 2: the client's own `#prompt-box` measurement is the real column width; fall
				// back to the viewport capped at the default (never wider than the old fixed
				// guess, still narrower than it on a phone) only when a client hasn't reported one.
				hintColumns =
					hint.promptColumns ?? Math.min(hint.columns, defaultTerminalColumns);
			}
		}
		const size = clampTerminalSize({
			columns: params.cols ?? hintColumns ?? defaultTerminalColumns,
			rows: params.rows ?? hint?.rows ?? defaultTerminalRows,
		});
		const terminal = new HeadlessTerminal(size);
		const tui = new TuiShim(terminal, {
			requestRender: (force) => {
				if (force) mount.scheduler.flush(true);
				else mount.scheduler.schedule(true);
			},
		});
		const scheduler = new StreamingFrameScheduler<true>(() =>
			this.#commitFrame(params.id),
		);
		scheduler.setDisplayHz(surfaceFrameHz);
		const mount: Mount = {
			id: params.id,
			kind: params.kind,
			terminal,
			tui,
			scheduler,
			overlayOptionsResolver: params.overlayOptionsResolver,
			overlay: params.overlay,
			belowEditor: params.belowEditor === true,
			component: undefined,
			title: params.title,
			revision: 0,
			disposed: false,
			settle: undefined,
			clientSizes: new Map(),
		};
		this.#mounts.set(params.id, mount);
		tui.start();
		return mount;
	}

	#commitFrame(id: string): void {
		const mount = this.#mounts.get(id);
		if (!mount || mount.disposed) return;
		const cols = mount.terminal.columns;
		const rows = mount.terminal.rows;
		const rawOverlayOptions = mount.overlayOptionsResolver?.();
		if (rawOverlayOptions?.visible && !rawOverlayOptions.visible(cols, rows)) {
			// The extension's own responsive predicate says "don't show this
			// overlay at this size" — keep the last published frame rather than
			// publishing an empty one.
			return;
		}
		const overlayOptions = mount.overlay
			? toTerminalSurfaceOverlayOptions(rawOverlayOptions)
			: undefined;
		const rawLines = mount.tui.render(cols).slice(0, maxTerminalSurfaceLines);
		// An overlay renders at its resolved `OverlayOptions.width`, not the full grid.
		const width =
			mount.overlay && mount.tui.lastOverlayWidth > 0
				? mount.tui.lastOverlayWidth
				: cols;
		const lines: string[] = [];
		let cursor: TerminalSurface["cursor"];
		for (const [index, rawLine] of rawLines.entries()) {
			const clipped =
				rawLine.length > maxTerminalSurfaceLineLength
					? rawLine.slice(0, maxTerminalSurfaceLineLength)
					: rawLine;
			const rendered = ansiLineToHtml(clipped);
			lines.push(rendered.html);
			if (rendered.cursorColumn !== undefined && cursor === undefined) {
				cursor = { row: index, column: rendered.cursorColumn };
			}
		}
		mount.revision += 1;
		this.#snapshots.set(id, {
			id,
			kind: mount.kind,
			title: mount.title,
			overlayOptions,
			belowEditor: mount.belowEditor,
			lines,
			cursor,
			cols,
			rows,
			width,
			revision: mount.revision,
		});
		this.#publish();
	}

	#publish(): void {
		this.options.onUpdate(this.snapshot());
	}
}

function isOverlayOptionsFactory(
	overlayOptions: OverlayOptions | (() => OverlayOptions) | undefined,
): overlayOptions is () => OverlayOptions {
	return typeof overlayOptions === "function";
}

export function resolveOverlayOptions(
	overlayOptions: OverlayOptions | (() => OverlayOptions) | undefined,
): OverlayOptions | undefined {
	if (isOverlayOptionsFactory(overlayOptions)) {
		try {
			return overlayOptions();
		} catch (error) {
			console.error("Terminal surface overlayOptions() threw", error);
			return undefined;
		}
	}
	return overlayOptions;
}

function toTerminalSurfaceOverlayOptions(
	options: OverlayOptions | undefined,
): TerminalSurfaceOverlayOptions | undefined {
	if (!options) return {};
	return {
		width: sizeOption(options.width),
		minWidth: cellOption(options.minWidth),
		maxHeight: sizeOption(options.maxHeight),
		anchor: options.anchor,
		offsetX: cellOption(options.offsetX),
		offsetY: cellOption(options.offsetY),
		row: sizeOption(options.row),
		col: sizeOption(options.col),
		margin: cellOption(
			isNumber(options.margin)
				? options.margin
				: (options.margin?.top ?? options.margin?.left),
		),
		nonCapturing: options.nonCapturing,
	};
}

/**
 * Extensions are untrusted at runtime whatever their declared types say, and
 * these values end up in a `style` attribute, so only finite numbers and
 * pi-tui's `N%` size strings survive.
 */
function cellOption(value: number | undefined): number | undefined {
	return isNumber(value) ? value : undefined;
}

function sizeOption(value: number | string | undefined): number | string | undefined {
	if (isNumber(value)) return cellOption(value);
	return isString(value) && /^\d+(?:\.\d+)?%$/.test(value) ? value : undefined;
}
