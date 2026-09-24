import { endpoints } from "../../src/server/routes/endpoints.ts";

/**
 * Client-side companion for the terminal-surface host (see
 * `src/ui/terminal-surface.tsx`, `src/agent/terminal-surface/*`): encodes
 * browser `KeyboardEvent`s into the terminal byte sequences pi-tui's
 * `Component.handleInput()` expects (legacy VT100/xterm sequences plus the
 * standard `CSI 1;<mod>` extended-modifier and `CSI 27;<mod>;<code>~`
 * "modifyOtherKeys" forms pi-tui's own parser accepts — see
 * `@earendil-works/pi-tui`'s `dist/keys.js`), measures each surface's
 * monospace cell grid and reports resizes, and drives the coarse-pointer
 * soft-key bar. Every mounted surface is driven through a single hidden
 * `<textarea>` proxy per surface (the classic xterm.js technique) so real
 * IME composition and mobile predictive text both work, even though the
 * visible content is a read-only `<pre>`.
 */

const gridSelector = "[data-terminal-surface-grid]";
const bodySelector = "[data-terminal-surface-body]";
const inputSelector = "[data-terminal-surface-input]";
const keysBarSelector = "[data-terminal-surface-keys]";

const MOD = { shift: 1, alt: 2, ctrl: 4 };

/** `key.toLowerCase().charCodeAt(0) & 0x1f` — mirrors pi-tui's `rawCtrlChar()`. */
function rawCtrlChar(key) {
	const char = key.toLowerCase();
	const code = char.charCodeAt(0);
	if (
		(code >= 97 && code <= 122) ||
		char === "[" ||
		char === "\\" ||
		char === "]" ||
		char === "_"
	) {
		return String.fromCharCode(code & 0x1f);
	}
	if (char === "-") return String.fromCharCode(31);
	return null;
}

function modifierValue(event) {
	let mod = 0;
	if (event.shiftKey) mod |= MOD.shift;
	if (event.altKey) mod |= MOD.alt;
	if (event.ctrlKey) mod |= MOD.ctrl;
	return mod;
}

/** `CSI 1;<mod+1><final>` for arrows/home/end, or the plain 3-byte form when unmodified. */
function csiCursor(mod, final) {
	return mod === 0 ? `\x1b[${final}` : `\x1b[1;${mod + 1}${final}`;
}

/** `CSI <num>;<mod+1>~` for delete/insert/pgup/pgdn, or the plain form when unmodified. */
function csiFunctional(num, mod) {
	return mod === 0 ? `\x1b[${num}~` : `\x1b[${num};${mod + 1}~`;
}

/** xterm's `modifyOtherKeys` form — the fallback pi-tui's parser accepts for a
 * modified printable/enter/tab/escape/space/backspace it has no simpler encoding for. */
function modifyOtherKeys(codepoint, mod) {
	return `\x1b[27;${mod + 1};${codepoint}~`;
}

/**
 * Encodes one `KeyboardEvent` (already merged with any sticky Ctrl/Alt from
 * the mobile soft-key bar) into terminal bytes, or `null` if this key isn't
 * part of the supported contract (e.g. a bare modifier keydown, or a
 * function key outside the soft-key bar's scope) and should fall through to
 * the browser / a regular `input` event instead.
 */
export function encodeKeyEvent(event) {
	const mod = modifierValue(event);
	switch (event.key) {
		case "Escape":
			return mod === 0 ? "\x1b" : null;
		case "Enter":
			if (mod === 0) return "\r";
			if (mod === MOD.shift) return "\x1b\r";
			if (mod === MOD.alt) return "\x1b\r";
			return modifyOtherKeys(13, mod);
		case "Tab":
			if (mod === 0) return "\t";
			if (mod === MOD.shift) return "\x1b[Z";
			return modifyOtherKeys(9, mod);
		case "Backspace":
			if (mod === MOD.alt) return "\x1b\x7f";
			return "\x7f";
		case "Delete":
			return csiFunctional(3, mod);
		case "Insert":
			return csiFunctional(2, mod);
		case "Home":
			return csiCursor(mod, "H");
		case "End":
			return csiCursor(mod, "F");
		case "PageUp":
			return csiFunctional(5, mod);
		case "PageDown":
			return csiFunctional(6, mod);
		case "ArrowUp":
			return csiCursor(mod, "A");
		case "ArrowDown":
			return csiCursor(mod, "B");
		case "ArrowRight":
			return csiCursor(mod, "C");
		case "ArrowLeft":
			return csiCursor(mod, "D");
		case " ":
			if (mod === MOD.ctrl) return "\x00";
			if (mod === MOD.alt) return "\x1b ";
			if (mod === 0) return " ";
			return modifyOtherKeys(32, mod);
		default:
			break;
	}
	if (event.key.length !== 1) return null;
	const ctrl = (mod & MOD.ctrl) !== 0;
	const alt = (mod & MOD.alt) !== 0;
	if (ctrl) {
		const ctrlChar = rawCtrlChar(event.key);
		if (ctrlChar) return alt ? `\x1b${ctrlChar}` : ctrlChar;
	}
	if (alt) return `\x1b${event.key}`;
	return event.key;
}

const softKeyToEvent = {
	escape: { key: "Escape" },
	tab: { key: "Tab" },
	up: { key: "ArrowUp" },
	down: { key: "ArrowDown" },
	left: { key: "ArrowLeft" },
	right: { key: "ArrowRight" },
	enter: { key: "Enter" },
};

/** Sticky Ctrl/Alt state (mobile soft-key bar), consumed by the next dispatched key. */
const sticky = { ctrl: false, alt: false };

function stickyModifiers() {
	return { ctrlKey: sticky.ctrl, altKey: sticky.alt, shiftKey: false };
}

function clearSticky() {
	if (!sticky.ctrl && !sticky.alt) return;
	sticky.ctrl = false;
	sticky.alt = false;
	for (const button of document.querySelectorAll(".terminal-key-sticky")) {
		button.setAttribute("aria-pressed", "false");
	}
}

let probe;
function ensureProbe() {
	if (probe?.isConnected) return probe;
	probe = document.createElement("pre");
	probe.className = "terminal-surface-body terminal-surface-probe";
	probe.setAttribute("aria-hidden", "true");
	// `width: 20ch` (not 20 rendered 'M' glyphs) so this probe's own box is defined in the
	// exact unit `terminal-surface.tsx` sizes every surface in (`Nch` widths — `overlayStyleVars`,
	// `--terminal-overlay-min-width`). A glyph-width probe can read a systematically different
	// value than what `ch` itself resolves to for the same font (border-box sizing makes this
	// element's own border-box width authoritative, not a footnote to subtract padding from) —
	// on an overlay now sized to exactly fit its resolved column count (F4), that gap showed up
	// as a small residual horizontal scrollbar instead of the un-narrowed box absorbing it.
	probe.style.cssText =
		"position:absolute;visibility:hidden;left:-9999px;top:-9999px;pointer-events:none;height:auto;flex:none;width:20ch;";
	probe.textContent = "M";
	document.body.appendChild(probe);
	return probe;
}

function inlinePadding(element) {
	const style = getComputedStyle(element);
	return (
		(Number.parseFloat(style.paddingInlineStart) || 0) +
		(Number.parseFloat(style.paddingInlineEnd) || 0)
	);
}

function measureCell() {
	const element = ensureProbe();
	const rect = element.getBoundingClientRect();
	const width = rect.width / 20;
	const height =
		rect.height || Number.parseFloat(getComputedStyle(element).lineHeight) || 0;
	if (!width || !height) return undefined;
	return { width, height };
}

/**
 * The `#prompt-box` column's own available width, in cells (R7-B item 2): closer to a
 * prompt-column surface's (inline/widget/footer/header) true first-frame size than the whole
 * browser viewport ever was — the prompt column's own padding/gutters aren't a fixed fraction of
 * the viewport, so on a phone that gap alone was a further ~150ms of first-paint overflow after
 * the Round 6 fix (see `r6-audit.md`'s open item, and `TerminalSurfaceController`'s use of this
 * hint). `undefined` before `#prompt-box` exists in the DOM (there is no column to measure yet).
 *
 * A surface's cells start inside its own chrome (the grid's border, the body's padding) and
 * beside the scrollbar `#terminal-surface-persistent` shows once it overflows, so the box's own
 * width over-seeded every prompt-column surface by about six cells: a ~150ms first-paint
 * overflow at every viewport width (R7 final audit). The width is therefore measured from a
 * replica of a surface where one would mount, less a scrollbar gutter, falling back to the
 * box's own width when that host isn't in the DOM. Too narrow by a cell or two only means a
 * surface grows once its own resize report lands; too wide means it overflows until then.
 */
export function measurePromptColumnCells(cell) {
	const box = document.getElementById("prompt-box");
	if (!box) return undefined;
	const width = measurePromptSurfaceWidth() ?? box.clientWidth - inlinePadding(box);
	if (!(width > 0)) return undefined;
	return Math.max(20, Math.floor(width / cell.width));
}

/** The px width a prompt-column surface's cells get, from a short-lived, invisible replica of
 * `renderTerminalSurfaceBlock`'s nesting inside the persistent surfaces' own parent. */
function measurePromptSurfaceWidth() {
	const host = document.getElementById("terminal-surface-persistent")?.parentElement;
	if (!host) return undefined;
	let surface;
	try {
		surface = document.createElement("div");
		surface.className = "terminal-surface terminal-surface-widget";
		surface.setAttribute("aria-hidden", "true");
		surface.style.cssText =
			"visibility:hidden;pointer-events:none;height:0;overflow:hidden;margin:0;";
		const grid = document.createElement("div");
		grid.className = "terminal-surface-grid";
		const body = document.createElement("pre");
		body.className = "terminal-surface-body";
		grid.appendChild(body);
		surface.appendChild(grid);
		host.appendChild(surface);
		const scrollbar =
			Number.parseFloat(
				getComputedStyle(document.documentElement).getPropertyValue(
					"--terminal-scrollbar-size",
				),
			) || 0;
		const width = body.clientWidth - inlinePadding(body) - scrollbar;
		return width > 0 ? width : undefined;
	} catch {
		return undefined;
	} finally {
		surface?.remove();
	}
}

/**
 * An off-screen replica of a percentage-width overlay's dialog chrome (R7-B item 3): the same
 * `.dialog.terminal-surface-dialog > .terminal-surface-dialog-content > .terminal-surface-grid >
 * .terminal-surface-body` nesting `renderTerminalSurfaceDialog` renders, positioned out of flow
 * so nothing sees it. Its own border/padding sum (`measureOverlayChrome`) is CSS-fixed, not
 * proportional to how wide the box currently is (the same assumption
 * `percentOverlayAvailableWidth` below relies on for a *live* dialog), so this needs no live
 * overlay to answer the same question one would once its own resize report lands.
 */
let overlayChromeProbe;
function ensureOverlayChromeProbe() {
	if (overlayChromeProbe?.dialog.isConnected) return overlayChromeProbe;
	// Best-effort, like every other probe/report in this module: a DOM too minimal to build
	// this (a test's fake `document`, an exotic embed) just means `measureOverlayChrome` falls
	// back to 0 — the same "no chrome known yet" answer this hint gave before R7-B.
	try {
		const dialog = document.createElement("div");
		dialog.className = "dialog terminal-surface-dialog terminal-surface-probe";
		dialog.setAttribute("aria-hidden", "true");
		dialog.style.cssText =
			"position:absolute;visibility:hidden;left:-9999px;top:-9999px;margin:0;";
		const content = document.createElement("div");
		content.className = "terminal-surface-dialog-content";
		const grid = document.createElement("div");
		grid.className = "terminal-surface-grid";
		const body = document.createElement("pre");
		body.className = "terminal-surface-body";
		grid.appendChild(body);
		content.appendChild(grid);
		dialog.appendChild(content);
		document.body.appendChild(dialog);
		overlayChromeProbe = { dialog, content, body };
	} catch {
		overlayChromeProbe = undefined;
	}
	return overlayChromeProbe;
}

/** The fixed horizontal chrome `percentOverlayAvailableWidth` subtracts from the viewport for a
 * *live* percentage overlay, measured up front from the probe above instead. */
function measureOverlayChrome() {
	const probe = ensureOverlayChromeProbe();
	if (!probe) return 0;
	const bodyAvailable = probe.body.clientWidth - inlinePadding(probe.body);
	const chrome = probe.content.getBoundingClientRect().width - bodyAvailable;
	return Number.isFinite(chrome) && chrome > 0 ? chrome : 0;
}

/**
 * The width, in cells, of a custom message/entry render card in this tab's transcript: what
 * `RuntimeController` renders `registerMessageRenderer`/`registerEntryRenderer` output at, so
 * a render's lines fit the card instead of wrapping mid-line. Measured from a short-lived,
 * invisible replica of the card's real nesting (`messages.tsx`'s `renderContextMessage`)
 * inside `#message-list`, with a scrollbar reserved the way a long render has one. The card's
 * own font is measured too, since it need not match the terminal-surface cell. `undefined`
 * before `#message-list` exists or when the DOM cannot lay the replica out.
 */
export function measureTranscriptRenderCells() {
	const list = document.getElementById("message-list");
	if (!list) return undefined;
	let article;
	try {
		article = document.createElement("article");
		article.className = "message message-context tool-timeline-item message-skill";
		article.setAttribute("aria-hidden", "true");
		article.style.cssText =
			"position:absolute;left:0;right:0;top:0;visibility:hidden;pointer-events:none;contain:none;";
		const details = document.createElement("details");
		details.className = "context-details";
		details.setAttribute("open", "");
		const summary = document.createElement("summary");
		summary.className = "context-summary";
		const surface = document.createElement("div");
		surface.className = "tool-output-surface context-output";
		const render = document.createElement("div");
		render.className = "message-custom-render";
		render.style.overflowY = "scroll";
		const glyphs = document.createElement("span");
		glyphs.style.whiteSpace = "pre";
		glyphs.textContent = "0".repeat(20);
		render.appendChild(glyphs);
		surface.appendChild(render);
		details.append(summary, surface);
		article.appendChild(details);
		list.appendChild(article);
		const glyphWidth = glyphs.getBoundingClientRect().width / 20;
		const width = render.clientWidth - inlinePadding(render);
		if (!(glyphWidth > 0) || !(width > 0)) return undefined;
		return Math.max(20, Math.floor(width / glyphWidth));
	} catch {
		return undefined;
	} finally {
		article?.remove();
	}
}

let viewportReportTimer;

/**
 * Reports the whole browser viewport's terminal-cell grid to the server (Round 6 F2), once per
 * connection (`bindTerminalSurfaces`'s own call, below) and on window resize (debounced, same
 * 120ms as `scheduleResize`'s per-surface debounce) — so `TerminalSurfaceController` can seed a
 * brand-new surface close to its true size instead of a fixed 100x30 guess, before that
 * surface's own `ResizeObserver` has ever fired. Necessarily approximate (a surface's own
 * chrome, an overlay's percentage width, aren't known yet), which is fine: the surface's own
 * resize report still corrects it once it lands, same as always — this only narrows the gap the
 * very first published frame opens with. `document.body.dispatchEvent` (not `window`), matching
 * `display-refresh.js`'s identical pattern, so `page.tsx`'s `data-on:pi-ui-terminal-viewport`
 * handler (on `<body>`, no `__window` modifier) can embed the server-rendered per-tab client id
 * a plain JS module has no other way to reach.
 *
 * R7-B items 2 & 3: alongside the whole-viewport `cols`/`rows`, also reports this tab's actually
 * measured `#prompt-box` width (`promptCols`) and the width a percentage-width overlay will
 * resolve against once a real dialog's chrome is subtracted (`overlayPercentCols`) — both closer
 * approximations `TerminalSurfaceController` prefers over the raw viewport hint when a client
 * sends them (see that module's `#create`).
 */
function reportViewportCells() {
	const cell = measureCell();
	if (!cell) return;
	const cols = Math.max(
		20,
		Math.floor(document.documentElement.clientWidth / cell.width),
	);
	const rows = Math.max(
		3,
		Math.floor(document.documentElement.clientHeight / cell.height),
	);
	const promptCols = measurePromptColumnCells(cell);
	const transcriptCols = measureTranscriptRenderCells();
	const overlayPercentCols = Math.max(
		20,
		Math.floor(
			(document.documentElement.clientWidth - measureOverlayChrome()) / cell.width,
		),
	);
	try {
		document.body.dispatchEvent(
			new CustomEvent("pi-ui-terminal-viewport", {
				detail: { cols, rows, promptCols, overlayPercentCols, transcriptCols },
			}),
		);
	} catch {
		// Best-effort, same as postJson below: a `document.body` that cannot
		// dispatch (an exotic embed, or a test's minimal fake DOM that never
		// needed this event before) just means this one hint is skipped — the
		// surface's own resize report still corrects its size once it lands.
	}
}

function scheduleViewportReport() {
	clearTimeout(viewportReportTimer);
	viewportReportTimer = setTimeout(reportViewportCells, 120);
}

async function postJson(url, body) {
	try {
		await fetch(url, {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify(body),
		});
	} catch {
		// Best-effort: a dropped keystroke/resize on a flaky connection isn't
		// worth surfacing — the next one (or the SSE reconnect) catches up.
	}
}

/** Per-surface input not yet posted; sends are serialized so keystrokes can't arrive out of order. */
const queuedInput = new Map();
const sendingSurfaces = new Set();

async function flushInput(surfaceId) {
	sendingSurfaces.add(surfaceId);
	while (queuedInput.has(surfaceId)) {
		const data = queuedInput.get(surfaceId);
		queuedInput.delete(surfaceId);
		await postJson(endpoints.terminalSurfaceInput, { surfaceId, data });
	}
	sendingSurfaces.delete(surfaceId);
}

function sendInput(surfaceId, data) {
	if (!surfaceId || !data) return;
	// Keys typed while a post is in flight are batched into the next one, in order.
	queuedInput.set(surfaceId, (queuedInput.get(surfaceId) ?? "") + data);
	if (!sendingSurfaces.has(surfaceId)) void flushInput(surfaceId);
}

const pendingResize = new Map();

function surfaceIdOf(element) {
	return element?.closest(gridSelector)?.dataset.terminalSurfaceGrid;
}

function scheduleResize(grid) {
	const id = grid.dataset.terminalSurfaceGrid;
	if (!id) return;
	clearTimeout(pendingResize.get(id));
	pendingResize.set(
		id,
		setTimeout(() => {
			pendingResize.delete(id);
			sendResize(id, grid);
		}, 120),
	);
}

/**
 * The height a grid's terminal reports as its rows. An overlay's dialog is sized to what the
 * component rendered, so its current height says nothing about the terminal: pi-tui lays
 * overlays out against the whole terminal (`maxHeight: "85%"` of its rows), and a component
 * that sizes itself from `terminal.rows` (ask_user's overlay) would see a few rows, render a
 * "terminal too short" stub, and keep the dialog that small. Report the height the dialog can
 * grow to instead; it stays the same as the dialog grows, so this can't feed back on itself.
 */
function availableHeight(grid, rect) {
	if (grid.dataset.terminalSurfaceKind !== "overlay") return rect.height;
	const content = grid.closest(".terminal-surface-dialog-content");
	if (!content) return rect.height;
	const maxHeight = Number.parseFloat(getComputedStyle(content).maxHeight);
	if (!Number.isFinite(maxHeight)) return rect.height;
	const chrome = content.getBoundingClientRect().height - rect.height;
	return Math.max(rect.height, maxHeight - chrome);
}

/**
 * The reference width `cols` is measured against for a `N%`-width overlay (`data-terminal-
 * surface-percent-width`, set by `terminal-surface.tsx` when `OverlayOptions.width` is a
 * percentage). The dialog's own box is now sized to exactly fit the *already-resolved* column
 * count (`overlayStyleVars`), so measuring that box directly and reporting it back as `cols`
 * would resolve the percentage against its own last answer — each pass narrowing further with
 * no floor (F4: the box would keep shrinking instead of settling ~8% short). Measure the
 * viewport instead, adjusted for the box's own fixed chrome (padding/border, which stays the
 * same whatever the box's current width): a stable reference the percentage can converge
 * against without feeding on itself, mirroring `availableHeight`'s reasoning for the same
 * problem in the other dimension. Never floored at the box's current width: after the window
 * narrows, that box is still the old (too wide) size, and flooring at it kept the overlay
 * wider than the new viewport.
 */
function percentOverlayAvailableWidth(grid, bodyAvailable) {
	const content = grid.closest(".terminal-surface-dialog-content");
	if (!content) return bodyAvailable;
	const chrome = content.getBoundingClientRect().width - bodyAvailable;
	return Math.max(0, document.documentElement.clientWidth - chrome);
}

function sendResize(surfaceId, grid) {
	const cell = measureCell();
	if (!cell) return;
	const rect = grid.getBoundingClientRect();
	const body = grid.querySelector(bodySelector);
	// The body's client box (inside its border and any scrollbar, minus padding) is
	// what lines actually get; the grid's border box over-fits by a column on phones.
	const bodyAvailable = body ? body.clientWidth - inlinePadding(body) : rect.width;
	const available =
		grid.dataset.terminalSurfacePercentWidth === "true"
			? percentOverlayAvailableWidth(grid, bodyAvailable)
			: bodyAvailable;
	const cols = Math.max(20, Math.floor(available / cell.width));
	const rows = Math.max(3, Math.floor(availableHeight(grid, rect) / cell.height));
	const previousCols = Number(body?.dataset.cols);
	const previousRows = Number(body?.dataset.rows);
	if (cols === previousCols && rows === previousRows) return;
	const size =
		grid.dataset.terminalSurfacePercentWidth === "true"
			? percentOverlayReport(surfaceId, { cols, rows }, previousCols, previousRows)
			: { cols, rows };
	if (size) {
		// R7-B item 1: which tab this report is from, so a non-overlay surface (an overlay
		// ignores it server-side — see `TerminalSurfaceController.resize`) can be sized at the
		// narrowest of every tab currently displaying it instead of whichever last reported.
		postJson(endpoints.terminalSurfaceResize, {
			surfaceId,
			...size,
			clientId: document.body?.dataset?.displayClientId,
		});
	}
}

/** The size each percentage-width overlay was last reported at by THIS tab. */
const reportedPercentSizes = new Map();

/**
 * What, if anything, to report for a percentage-width overlay. A surface has one size shared
 * by every tab. A percentage overlay's box is sized from that shared size, but each tab
 * measures it against its own viewport, so two tabs of different sizes each saw the other's
 * size, re-reported their own, and flipped the overlay between the two about every 150ms for
 * as long as it stayed open. Report this tab's own size only when that measurement changed
 * (the overlay opened, or the window resized). Otherwise answer only a shared size larger than
 * this tab can show, and then with the smaller of the two in each dimension, so the tabs
 * settle on a size that fits every one of them instead of fighting.
 */
function percentOverlayReport(surfaceId, measured, sharedCols, sharedRows) {
	const key = `${measured.cols}x${measured.rows}`;
	if (reportedPercentSizes.get(surfaceId) !== key) {
		reportedPercentSizes.delete(surfaceId);
		reportedPercentSizes.set(surfaceId, key);
		// Each overlay mount has a fresh id; keep only the most recent few.
		if (reportedPercentSizes.size > 32) {
			reportedPercentSizes.delete(reportedPercentSizes.keys().next().value);
		}
		return measured;
	}
	if (!(sharedCols > measured.cols) && !(sharedRows > measured.rows)) return undefined;
	return {
		cols: Math.min(measured.cols, sharedCols || measured.cols),
		rows: Math.min(measured.rows, sharedRows || measured.rows),
	};
}

let resizeObserver;
function ensureResizeObserver() {
	if (resizeObserver || typeof ResizeObserver === "undefined") return resizeObserver;
	resizeObserver = new ResizeObserver((entries) => {
		for (const entry of entries) scheduleResize(entry.target);
	});
	return resizeObserver;
}

const observedGrids = new WeakSet();
function observeNewGrids(root = document) {
	const observer = ensureResizeObserver();
	if (!observer) return;
	for (const grid of root.querySelectorAll(gridSelector)) {
		if (observedGrids.has(grid)) continue;
		observedGrids.add(grid);
		observer.observe(grid);
		// A freshly mounted surface hasn't told the server its measured size
		// yet — resize immediately rather than waiting for the next layout
		// change, so it starts at the right column/row count.
		scheduleResize(grid);
		// A non-overlay `custom()` surface takes the prompt editor's place (and its
		// focus) in the TUI, so it takes keyboard focus here too as soon as it mounts;
		// overlays get it from `terminalSurfaceOverlayOpenScript` when their dialog opens.
		if (grid.dataset.terminalSurfaceKind === "inline") {
			grid.querySelector(inputSelector)?.focus({ preventScroll: true });
		}
	}
}

/** Surfaces whose hidden input proxy holds keyboard focus while mounted. */
const focusHoldingSurfaceSelector =
	".terminal-surface-inline, .terminal-surface-overlay, .terminal-surface-dialog";

/**
 * Restores focus to the prompt editor once an inline `custom()` surface or an overlay's
 * dialog unmounts (it resolved/was replaced; an overlay closed with Esc is removed by the
 * server while its input proxy still has focus): that proxy is gone, so without this the
 * browser drops focus to `<body>` and keyboard interaction stalls (m5).
 */
export function restoreFocusAfterSurfaceUnmount(removedNodes) {
	if (document.activeElement !== document.body && document.activeElement !== null)
		return;
	const unmounted = [...removedNodes].some(
		(node) =>
			node instanceof Element &&
			(node.matches(focusHoldingSurfaceSelector) ||
				node.querySelector(focusHoldingSurfaceSelector)),
	);
	if (!unmounted) return;
	document.getElementById("prompt-input")?.focus({ preventScroll: true });
}

function handleKeydown(event) {
	const input = event.target;
	if (!(input instanceof HTMLElement) || !input.matches(inputSelector)) return;
	if (event.isComposing) return;
	const surfaceId = surfaceIdOf(input);
	if (!surfaceId) return;
	const merged = {
		key: event.key,
		shiftKey: event.shiftKey,
		ctrlKey: event.ctrlKey || sticky.ctrl,
		altKey: event.altKey || sticky.alt,
	};
	const encoded = encodeKeyEvent(merged);
	if (encoded === null) return;
	event.preventDefault();
	if (input instanceof HTMLTextAreaElement) input.value = "";
	clearSticky();
	sendInput(surfaceId, encoded);
}

/** Handles printable text the IME/mobile keyboard commits via `input`/`compositionend`
 * rather than `keydown` (predictive text, autocomplete, most non-Latin IMEs). */
function handleCompositionEnd(event) {
	const input = event.target;
	if (!(input instanceof HTMLTextAreaElement) || !input.matches(inputSelector)) return;
	const surfaceId = surfaceIdOf(input);
	const text = event.data ?? input.value;
	input.value = "";
	if (surfaceId && text) sendInput(surfaceId, text);
}

function handleInput(event) {
	const input = event.target;
	if (!(input instanceof HTMLTextAreaElement) || !input.matches(inputSelector)) return;
	if (event.isComposing) return;
	// `keydown` already handled and cleared this input for every key this
	// module recognizes; anything that still lands here (soft-keyboard
	// autocomplete/emoji picker insertions, `insertText` without a `keydown`)
	// is forwarded as plain text.
	if (!event.inputType?.startsWith("insertText") || !input.value) return;
	const surfaceId = surfaceIdOf(input);
	const text = input.value;
	input.value = "";
	if (surfaceId) sendInput(surfaceId, text);
}

function handlePaste(event) {
	const input = event.target;
	if (!(input instanceof HTMLElement) || !input.matches(inputSelector)) return;
	const surfaceId = surfaceIdOf(input);
	if (!surfaceId) return;
	const text = event.clipboardData?.getData("text");
	if (!text) return;
	event.preventDefault();
	sendInput(surfaceId, `\x1b[200~${text}\x1b[201~`);
}

const wheelLineSequence = { up: "\x1b[A", down: "\x1b[B" };

function handleWheel(event) {
	const grid =
		event.target instanceof Element ? event.target.closest(gridSelector) : null;
	if (!grid) return;
	const surfaceId = grid.dataset.terminalSurfaceGrid;
	if (!surfaceId || event.deltaY === 0) return;
	event.preventDefault();
	const usePage = event.ctrlKey || Math.abs(event.deltaY) > 240;
	if (usePage) {
		sendInput(surfaceId, event.deltaY > 0 ? "\x1b[6~" : "\x1b[5~");
		return;
	}
	const lines = Math.max(1, Math.min(3, Math.round(Math.abs(event.deltaY) / 40)));
	const sequence = event.deltaY > 0 ? wheelLineSequence.down : wheelLineSequence.up;
	sendInput(surfaceId, sequence.repeat(lines));
}

/**
 * A light-dismissed overlay (`closedby="any"`: Esc, backdrop click, close button) sends the
 * dialog's `close` handler an Esc byte, but an extension `custom()` that doesn't treat Esc as
 * "done" (a long-running `Component` with its own exit key) never tears the surface down —
 * it just keeps running behind a now-hidden dialog. Reopen it non-modally shortly after, if
 * its grid is still mounted, instead of leaving it silently stuck (m10).
 */
function reopenIfStillRunning(dialog) {
	setTimeout(() => {
		if (dialog.open || !dialog.isConnected) return;
		if (dialog.querySelector(gridSelector)) dialog.show();
	}, 400);
}

function handleClick(event) {
	const target = event.target instanceof Element ? event.target : null;
	if (!target) return;
	const keyButton = target.closest("[data-terminal-key]");
	if (keyButton) {
		handleSoftKey(keyButton);
		return;
	}
	const grid = target.closest(gridSelector);
	if (grid && !target.closest(keysBarSelector)) {
		grid.querySelector(inputSelector)?.focus();
	}
}

function handleSoftKey(button) {
	const action = button.dataset.terminalKey;
	const grid = button.closest(gridSelector);
	const surfaceId = grid?.dataset.terminalSurfaceGrid;
	const input = grid?.querySelector(inputSelector);
	if (action === "ctrl" || action === "alt") {
		sticky[action] = !sticky[action];
		button.setAttribute("aria-pressed", sticky[action] ? "true" : "false");
		input?.focus();
		return;
	}
	const base = softKeyToEvent[action];
	if (!base || !surfaceId) return;
	const encoded = encodeKeyEvent({ key: base.key, ...stickyModifiers() });
	clearSticky();
	if (encoded !== null) sendInput(surfaceId, encoded);
	input?.focus();
}

/**
 * Publishes the platform's classic (space-taking) scrollbar width as
 * `--terminal-scrollbar-size` (0 where scrollbars overlay the content, e.g. on phones), so
 * `terminal-surface.css` can count an overlay body's always-reserved `scrollbar-gutter` in
 * `--terminal-overlay-chrome`. Without it a tall component's vertical scrollbar ate into the
 * N cells an overlay was sized for and grew a horizontal scrollbar over its last row.
 */
function publishScrollbarSize() {
	const probe = document.createElement("div");
	probe.style.cssText =
		"position:absolute;visibility:hidden;left:-9999px;top:-9999px;width:100px;height:50px;overflow-y:scroll;";
	document.body.appendChild(probe);
	const size = Math.max(0, probe.offsetWidth - probe.clientWidth) || 0;
	document.body.removeChild(probe);
	let style = document.getElementById("terminal-scrollbar-size");
	if (!style) {
		style = document.createElement("style");
		style.id = "terminal-scrollbar-size";
		document.head.appendChild(style);
	}
	style.textContent = `:root{--terminal-scrollbar-size:${size}px}`;
}

export function bindTerminalSurfaces() {
	publishScrollbarSize();
	reportViewportCells();
	// The call above runs before Datastar has bound `<body>`'s
	// `data-on:pi-ui-terminal-viewport`, so on a fresh page load its event goes
	// nowhere. The server also forgets a client's hint when its stream
	// disconnects. So report again whenever the main SSE stream (the
	// `data-init` `@get` on `#app`, see page.tsx) starts or retries: by then
	// the body handler is bound, and the report reaches the server as the
	// connection comes back.
	document.addEventListener("datastar-fetch", (event) => {
		const detail = event.detail;
		if (detail?.el?.id !== "app") return;
		if (detail.type !== "started" && detail.type !== "retrying") return;
		setTimeout(reportViewportCells, 0);
	});
	observeNewGrids();
	const mutationObserver = new MutationObserver((mutations) => {
		for (const mutation of mutations) {
			// A re-mounted surface keeps its slot id (`setHeader`/`setWidget` called again,
			// or every surface re-bound after /reload or a session switch), so the morph
			// reuses the already-observed grid element while the server resets it to the
			// default grid size; the ResizeObserver never fires for that. Re-fit whenever
			// the server-reported size changes (a no-op when it already matches).
			if (mutation.type === "attributes" && mutation.target instanceof Element) {
				const grid = mutation.target.closest(gridSelector);
				if (grid) scheduleResize(grid);
				continue;
			}
			if (mutation.addedNodes.length > 0) observeNewGrids(document);
			if (mutation.removedNodes.length > 0) {
				restoreFocusAfterSurfaceUnmount(mutation.removedNodes);
			}
		}
	});
	for (const root of [
		document.getElementById("terminal-surface-overlays"),
		document.getElementById("terminal-surface-persistent"),
		// Footer and `belowEditor` widget surfaces live in this sibling container
		// (after the prompt editor); without observing it, a surface mounted there
		// after page load is never ResizeObserver-fitted and stays at the default grid.
		document.getElementById("terminal-surface-persistent-below"),
	]) {
		if (root) {
			mutationObserver.observe(root, {
				childList: true,
				subtree: true,
				attributeFilter: ["data-cols", "data-rows"],
			});
		}
	}
	document.addEventListener("keydown", handleKeydown);
	document.addEventListener("compositionend", handleCompositionEnd);
	document.addEventListener("input", handleInput);
	document.addEventListener("paste", handlePaste, true);
	document.addEventListener("wheel", handleWheel, { passive: false });
	document.addEventListener("click", handleClick);
	// A mounted overlay's own box is sized in `ch`/`dvh` from the *last* resolved column/row
	// count (`overlayStyleVars`), so it doesn't itself change size when only the browser window
	// does — the ResizeObserver above, which watches each grid's own box, never fires for a bare
	// window resize (F4: a percentage-width overlay stayed at its open-time fit and drifted out
	// of sync with the new window size instead of re-filling it). Re-measure every currently
	// mounted surface directly off the resize event instead of waiting on a box that won't move
	// on its own; `scheduleResize` already debounces per surface, so this is cheap even while a
	// window drag fires it repeatedly.
	if (typeof window !== "undefined") {
		window.addEventListener("resize", () => {
			for (const grid of document.querySelectorAll(gridSelector))
				scheduleResize(grid);
			// Round 6 F2: re-report the whole-viewport hint too, so the NEXT surface that
			// mounts (not any currently mounted one, which the loop above already re-fits
			// directly) is seeded from the window's current size, not its size when the page
			// first loaded.
			scheduleViewportReport();
		});
	}
	document.addEventListener(
		"close",
		(event) => {
			const dialog = event.target;
			if (
				dialog instanceof HTMLElement &&
				dialog.matches(".terminal-surface-dialog")
			) {
				reopenIfStillRunning(dialog);
			}
		},
		true,
	);
}
