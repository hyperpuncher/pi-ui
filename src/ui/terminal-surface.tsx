import {
	isBlankTerminalLine,
	isVisibleTerminalOverlay,
	terminalSurfaceDialogId,
	type TerminalSurface,
	type TerminalSurfaceOverlayOptions,
} from "../agent/terminal-surface/types.ts";
import { endpoints } from "../server/routes/endpoints.ts";
import type { AppStateSnapshot } from "../state/app-store.ts";
import { isString } from "../utils/type-guards.ts";
import { Icon } from "./icon.tsx";
import { ArrowDown, ArrowLeft, ArrowRight, ArrowUp, CornerDownLeft } from "./icons.ts";
import { syncHtml } from "./sync-html.ts";

/**
 * Client-facing rendering for the terminal-surface host (see
 * `terminal-surface-controller.ts`): a monospace cell grid per surface,
 * `overlay`-kind surfaces wrapped in a native `<dialog>` styled like every
 * other pi-ui dialog/sheet. Every line is already pre-escaped, safe HTML
 * from `ansiLineToHtml` — never re-escaped here (matching how
 * `renderMarkdownStreaming`'s trusted output is embedded elsewhere in this
 * codebase). Key forwarding, cell-grid measurement/resize, and the mobile
 * soft-key bar's behavior live in `static/app/terminal-keys.js`; this module
 * only emits the markup and data attributes that script reads.
 */

// Non-overlay `custom()` surfaces ("inline") take the TUI editor's place there; in the browser they
// render with the other persistent surfaces just above the prompt editor.
/**
 * Only `custom()` surfaces (overlay + inline) take keyboard focus in pi-tui; widget, header
 * and footer components never do, so they get no touch soft-key bar (several persistent
 * surfaces would otherwise stack one bar each above and below the editor on mobile).
 */
const interactiveKinds = new Set<TerminalSurface["kind"]>(["overlay", "inline"]);
const persistentKinds = new Set<TerminalSurface["kind"]>([
	"inline",
	"widget",
	"footer",
	"header",
]);

export function renderTerminalSurfaceOverlays(
	state: Pick<AppStateSnapshot, "terminalSurfaces">,
): string {
	return syncHtml(
		<div id="terminal-surface-overlays">
			{state.terminalSurfaces
				.filter(isVisibleTerminalOverlay)
				.map((surface) => renderTerminalSurfaceDialog(surface))}
		</div>,
	);
}

/**
 * The persistent (non-overlay) host, split above/below the prompt editor (M3): a `header` or
 * a `widget` with no `belowEditor` renders above, next to the editor's other persistent
 * surfaces; a `footer` or a `belowEditor` widget renders after it — mirroring where pi-tui
 * itself puts a footer versus a header, and matching `renderExtensionWidgets`'s own
 * aboveEditor/belowEditor split for string-line widgets.
 */
export function renderTerminalSurfacePersistent(
	state: Pick<AppStateSnapshot, "terminalSurfaces">,
	placement: "aboveEditor" | "belowEditor" = "aboveEditor",
): string {
	const id =
		placement === "aboveEditor"
			? "terminal-surface-persistent"
			: "terminal-surface-persistent-below";
	return syncHtml(
		<div id={id} aria-live="polite">
			{state.terminalSurfaces
				.filter((surface) => persistentKinds.has(surface.kind))
				.filter((surface) =>
					surface.kind === "inline"
						? placement === "aboveEditor"
						: surface.belowEditor === (placement === "belowEditor"),
				)
				.map((surface) =>
					surface.kind === "inline" ? surface : trimBlankEdges(surface),
				)
				.filter((surface) => surface.lines.length > 0)
				.map((surface) => renderTerminalSurfaceBlock(surface))}
		</div>,
	);
}

/**
 * Widget/header/footer components are laid out for a full terminal, where blank padding
 * rows (a splash header sized to `terminal.rows`, a spacer line) cost nothing. Above the
 * prompt they would push the editor off screen, so leading/trailing blank rows are dropped
 * and a surface with nothing visible is not rendered at all.
 */
function trimBlankEdges(surface: TerminalSurface): TerminalSurface {
	const { lines } = surface;
	let start = 0;
	let end = lines.length;
	while (start < end && isBlankTerminalLine(lines[start] ?? "")) start += 1;
	while (end > start && isBlankTerminalLine(lines[end - 1] ?? "")) end -= 1;
	if (start === 0 && end === lines.length) return surface;
	const cursor =
		surface.cursor && surface.cursor.row >= start && surface.cursor.row < end
			? { ...surface.cursor, row: surface.cursor.row - start }
			: undefined;
	return { ...surface, lines: lines.slice(start, end), cursor };
}

/**
 * Open effects for currently-mounted `overlay`-kind surfaces — used to
 * auto-open newly created ones, both on the initial SSE view (`renderView`)
 * and via `AppStore.setTerminalSurfaces`'s per-surface diffing. `modal`
 * mirrors `OverlayOptions.nonCapturing`: a non-capturing overlay is shown
 * non-modally (`.show()`) so it never steals focus from the prompt.
 */
export function terminalSurfaceOverlayEffects(
	state: Pick<AppStateSnapshot, "terminalSurfaces">,
): readonly { id: string; modal: boolean }[] {
	return state.terminalSurfaces.filter(isVisibleTerminalOverlay).map((surface) => ({
		id: terminalSurfaceDialogId(surface.id),
		modal: !surface.overlayOptions?.nonCapturing,
	}));
}

/** The 9-way `OverlayAnchor` values `terminal-surface.css` has a `[data-anchor=…]` rule for. */
const knownAnchors = new Set([
	"top-left",
	"top-right",
	"top-center",
	"bottom-left",
	"bottom-right",
	"bottom-center",
	"left-center",
	"right-center",
	"center",
]);

/**
 * Options are sanitized to finite numbers and `N%` strings by the controller before they get
 * here. pi-tui resolves a percentage against the whole terminal, which here is the viewport
 * (`percentUnit`): as a CSS percentage it would resolve against the fit-content dialog itself,
 * which is circular, so a `maxHeight: "85%"` capped nothing.
 */
function sizeValue(
	value: number | string | undefined,
	unit: string,
	percentUnit: string,
): string | undefined {
	if (value === undefined) return undefined;
	if (!isString(value)) return `${value}${unit}`;
	const percent = /^(\d+(?:\.\d+)?)%$/.exec(value);
	return percent ? `${percent[1]}${percentUnit}` : value;
}

/**
 * A panel width that fits `columns` cells exactly: the cells themselves (`ch`, resolved
 * against the panel's monospace font) plus the fixed chrome between the panel's border box and
 * the first cell (`--terminal-overlay-chrome`, `terminal-surface.css`). Without the chrome
 * the panel came up ~56px short and every width-sized overlay grew a horizontal scrollbar.
 */
function cellsWidth(columns: number): string {
	return `calc(${columns}ch + var(--terminal-overlay-chrome))`;
}

/**
 * Projects `OverlayOptions` (columns/rows/anchor/offsets) onto CSS custom
 * properties `terminal-surface.css` reads — a best-effort approximation of
 * pi-tui's cell-based overlay layout using the same `ch`/`lh` units the
 * cell grid itself is sized with, not pixel-perfect terminal math.
 *
 * `width` is sized from `resolvedWidth` — the column count
 * `TerminalSurfaceController` (mirroring pi-tui's own `resolveOverlayLayout`)
 * actually rendered the component at — rather than re-deriving a box width
 * from the raw `options.width` here. A `width: "N%"` option is *already*
 * resolved against the client-reported terminal size once, server-side
 * (`tui-shim.ts`'s `#resolveOverlayWidth`); converting that same percentage
 * straight to `Nvw` here applied it a *second* time, since `terminal-keys.js`
 * measures the resulting dialog to report the next terminal size — a 92%
 * overlay converged to ~92% of its own already-92%-wide box, leaving an
 * ~8% gap on the right that never closed (F4). Sizing from the already-
 * resolved column count instead always fits exactly, whatever the option.
 */
function overlayStyleVars(
	options: TerminalSurfaceOverlayOptions | undefined,
	resolvedWidth: number,
): string | undefined {
	if (!options) return undefined;
	const decls: string[] = [];
	if (options.width !== undefined) {
		decls.push(`--terminal-overlay-width:${cellsWidth(resolvedWidth)}`);
	}
	if (options.minWidth !== undefined) {
		decls.push(`--terminal-overlay-min-width:${cellsWidth(options.minWidth)}`);
	}
	const maxHeight = sizeValue(options.maxHeight, "lh", "dvh");
	if (maxHeight) decls.push(`--terminal-overlay-max-height:${maxHeight}`);
	if (options.offsetX) decls.push(`--terminal-overlay-offset-x:${options.offsetX}ch`);
	if (options.offsetY) decls.push(`--terminal-overlay-offset-y:${options.offsetY}lh`);
	if (options.margin !== undefined) {
		decls.push(`--terminal-overlay-margin:${options.margin}ch`);
	}
	return decls.length > 0 ? decls.join(";") : undefined;
}

function renderTerminalSurfaceDialog(surface: TerminalSurface): string {
	const id = terminalSurfaceDialogId(surface.id);
	const options = surface.overlayOptions;
	const nonCapturing = options?.nonCapturing === true;
	const anchor =
		options?.anchor && knownAnchors.has(options.anchor) ? options.anchor : "center";
	return syncHtml(
		<dialog
			id={id}
			class="dialog terminal-surface-dialog"
			aria-labelledby={surface.title ? `${id}-title` : undefined}
			aria-label={surface.title ? undefined : "Extension panel"}
			closedby="any"
			data-preserve-attr="open"
			data-nonblocking={nonCapturing ? "true" : undefined}
			data-anchor={anchor}
			style={overlayStyleVars(options, surface.width)}
			data-on:close={`@post('${endpoints.terminalSurfaceInput}', { payload: { surfaceId: ${JSON.stringify(surface.id)}, data: '\\u001b' } })`}
		>
			{/* The dialog's single child is its panel (shared `.dialog > *` chrome); the panel is
			    sized to the surface's column grid, capped to the viewport. */}
			<div class="terminal-surface-dialog-content">
				{surface.title && (
					<header>
						<h2 id={`${id}-title`} safe>
							{surface.title}
						</h2>
					</header>
				)}
				{renderTerminalSurfaceBody(surface)}
			</div>
		</dialog>,
	);
}

function renderTerminalSurfaceBlock(surface: TerminalSurface): string {
	return syncHtml(
		<div
			class={`terminal-surface terminal-surface-${surface.kind}`}
			data-terminal-surface={surface.id}
		>
			{surface.title && (
				<div class="terminal-surface-title" safe>
					{surface.title}
				</div>
			)}
			{renderTerminalSurfaceBody(surface)}
		</div>,
	);
}

function renderTerminalSurfaceBody(surface: TerminalSurface): string {
	const cursor = surface.cursor;
	const caretStyle = cursor
		? `--terminal-cursor-row:${cursor.row};--terminal-cursor-col:${cursor.column}`
		: undefined;
	const label = surface.title ?? "Terminal panel";
	// See `overlayStyleVars`: the dialog is now sized to exactly fit `surface.width`, so
	// re-measuring the grid itself as the reference for the *next* percentage resolution
	// would just feed the previous answer back in, shrinking a `N%` overlay further on every
	// resize pass. `terminal-keys.js` reads this flag to measure the viewport instead.
	const percentWidth =
		surface.kind === "overlay" && isString(surface.overlayOptions?.width);
	return syncHtml(
		<div
			class="terminal-surface-grid"
			data-terminal-surface-grid={surface.id}
			data-terminal-surface-kind={surface.kind}
			data-terminal-surface-percent-width={percentWidth ? "true" : undefined}
			role="group"
			aria-label={label}
		>
			<pre
				class={
					cursor ? "terminal-surface-body has-caret" : "terminal-surface-body"
				}
				data-terminal-surface-body={surface.id}
				data-cols={surface.cols}
				data-rows={surface.rows}
				data-revision={surface.revision}
				style={caretStyle}
			>
				{surface.lines.join("\n")}
			</pre>
			<textarea
				class="terminal-surface-input"
				data-terminal-surface-input={surface.id}
				aria-label={label}
				spellcheck="false"
				rows="1"
				style={caretStyle}
				attrs={{
					autocomplete: "off",
					autocorrect: "off",
					autocapitalize: "off",
				}}
			/>
			{interactiveKinds.has(surface.kind) && renderSoftKeyBar(surface.id)}
		</div>,
	);
}

function renderSoftKeyBar(surfaceId: string): string {
	return syncHtml(
		<div
			class="terminal-surface-keys"
			data-terminal-surface-keys={surfaceId}
			role="toolbar"
			aria-label="Terminal keys"
		>
			<button
				type="button"
				class="btn terminal-key"
				data-variant="outline"
				data-terminal-key="escape"
			>
				Esc
			</button>
			<button
				type="button"
				class="btn terminal-key"
				data-variant="outline"
				data-terminal-key="tab"
			>
				Tab
			</button>
			<button
				type="button"
				class="btn terminal-key"
				data-variant="outline"
				data-size="icon-sm"
				data-terminal-key="up"
				aria-label="Up"
			>
				<Icon icon={ArrowUp} />
			</button>
			<button
				type="button"
				class="btn terminal-key"
				data-variant="outline"
				data-size="icon-sm"
				data-terminal-key="down"
				aria-label="Down"
			>
				<Icon icon={ArrowDown} />
			</button>
			<button
				type="button"
				class="btn terminal-key"
				data-variant="outline"
				data-size="icon-sm"
				data-terminal-key="left"
				aria-label="Left"
			>
				<Icon icon={ArrowLeft} />
			</button>
			<button
				type="button"
				class="btn terminal-key"
				data-variant="outline"
				data-size="icon-sm"
				data-terminal-key="right"
				aria-label="Right"
			>
				<Icon icon={ArrowRight} />
			</button>
			<button
				type="button"
				class="btn terminal-key"
				data-variant="outline"
				data-size="icon-sm"
				data-terminal-key="enter"
				aria-label="Enter"
			>
				<Icon icon={CornerDownLeft} />
			</button>
			<button
				type="button"
				class="btn terminal-key terminal-key-sticky"
				data-variant="outline"
				data-terminal-key="ctrl"
				aria-pressed="false"
			>
				Ctrl
			</button>
			<button
				type="button"
				class="btn terminal-key terminal-key-sticky"
				data-variant="outline"
				data-terminal-key="alt"
				aria-pressed="false"
			>
				Alt
			</button>
		</div>,
	);
}
