import { escapeHtml } from "../../utils/html.ts";

/**
 * Converts ANSI-styled lines from a `pi-tui` `Component.render()` call into
 * safe, pre-escaped HTML — the "headless TUI host" half of the terminal
 * surface (see `terminal-surface-controller.ts`). Only what a `render()`
 * call is documented to emit is handled: SGR color/attribute codes
 * (`ESC[...m`), OSC 8 hyperlinks, and the `CURSOR_MARKER` APC sequence.
 * Every other escape sequence (cursor movement, alternate-screen control,
 * unsupported OSC, …) is stripped rather than leaked into the page, since
 * `render()` output is meant to be composited onto a fixed-size line grid —
 * a component that emits raw cursor-movement bytes isn't part of this
 * contract, and letting such bytes reach the DOM would be unsafe besides.
 */

/** APC cursor marker `pi-tui`'s `Component`s emit at the caret position when focused. */
export const cursorMarker = "\u001b_pi:c\u0007";

/**
 * Best-effort mapping from the basic 16-color ANSI palette onto pi-ui's
 * existing semantic tokens (see the Round 2 plan's "Visual consistency":
 * map ANSI colors onto pi-ui tokens, not the raw xterm palette). pi-ui has
 * no dedicated "magenta"/"cyan" token, so those fall back to the closest
 * existing accent; this table only matters for components/extensions that
 * emit raw 4-bit SGR codes directly — the real `Theme` instance this
 * terminal surface mounts extensions with emits 24-bit truecolor, rendered
 * as literal RGB below, which is the theme's actual, intentional color.
 */
const ansiBasicToken: readonly string[] = [
	"var(--text-muted)", // 0 black
	"var(--status-error)", // 1 red
	"var(--status-success)", // 2 green
	"var(--status-warning)", // 3 yellow
	"var(--status-info)", // 4 blue
	"var(--status-info)", // 5 magenta (no dedicated token)
	"var(--status-success)", // 6 cyan (no dedicated token)
	"var(--text)", // 7 white
];

type SgrState = {
	bold: boolean;
	dim: boolean;
	italic: boolean;
	underline: boolean;
	inverse: boolean;
	strikethrough: boolean;
	fg?: string;
	bg?: string;
};

function freshState(): SgrState {
	return {
		bold: false,
		dim: false,
		italic: false,
		underline: false,
		inverse: false,
		strikethrough: false,
		// Explicit `undefined` (not simply omitted) so SGR 0's `Object.assign(state,
		// freshState())` actually clears a previously set color, rather than leaving
		// it untouched (`Object.assign` never deletes keys absent from its source).
		fg: undefined,
		bg: undefined,
	};
}

function is256Gray(index: number): number {
	return 8 + (index - 232) * 10;
}

/** `xterm-256color` palette index → a literal `rgb()` (or a mapped token for 0–15). */
function paletteColor(index: number): string {
	if (index < 8) return ansiBasicToken[index] ?? "var(--text)";
	if (index < 16) return ansiBasicToken[index - 8] ?? "var(--text)";
	if (index < 232) {
		const value = index - 16;
		const r = Math.floor(value / 36);
		const g = Math.floor((value / 6) % 6);
		const b = value % 6;
		const level = (component: number) => (component === 0 ? 0 : 55 + component * 40);
		return `rgb(${level(r)} ${level(g)} ${level(b)})`;
	}
	const gray = is256Gray(index);
	return `rgb(${gray} ${gray} ${gray})`;
}

/** Applies one SGR parameter run (the numbers between `ESC[` and `m`) to `state`. */
function applySgr(state: SgrState, params: readonly number[]): void {
	if (params.length === 0) params = [0];
	for (let index = 0; index < params.length; index += 1) {
		const code = params[index] ?? 0;
		if (code === 0) Object.assign(state, freshState());
		else if (code === 1) state.bold = true;
		else if (code === 2) state.dim = true;
		else if (code === 3) state.italic = true;
		else if (code === 4) state.underline = true;
		else if (code === 7) state.inverse = true;
		else if (code === 9) state.strikethrough = true;
		else if (code === 22) {
			state.bold = false;
			state.dim = false;
		} else if (code === 23) state.italic = false;
		else if (code === 24) state.underline = false;
		else if (code === 27) state.inverse = false;
		else if (code === 29) state.strikethrough = false;
		else if (code >= 30 && code <= 37) state.fg = ansiBasicToken[code - 30];
		else if (code === 39) state.fg = undefined;
		else if (code >= 40 && code <= 47)
			state.bg = translucent(ansiBasicToken[code - 40]);
		else if (code === 49) state.bg = undefined;
		else if (code >= 90 && code <= 97) state.fg = ansiBasicToken[code - 90];
		else if (code >= 100 && code <= 107)
			state.bg = translucent(ansiBasicToken[code - 100]);
		else if (code === 38 || code === 48) {
			const isBackground = code === 48;
			const mode = params[index + 1];
			if (mode === 5) {
				const paletteIndex = params[index + 2];
				if (paletteIndex !== undefined) {
					const color = paletteColor(paletteIndex);
					if (isBackground)
						state.bg = paletteIndex < 16 ? translucent(color) : color;
					else state.fg = color;
				}
				index += 2;
			} else if (mode === 2) {
				const r = params[index + 2] ?? 0;
				const g = params[index + 3] ?? 0;
				const b = params[index + 4] ?? 0;
				const color = `rgb(${r} ${g} ${b})`;
				if (isBackground) state.bg = color;
				else state.fg = color;
				index += 4;
			}
		}
	}
}

/** A 4-bit background is a strong, flat ANSI hue; blend it toward transparent so it
 * reads as a highlight rather than clashing with the app's chrome (AGENTS.md: project
 * colors use OKLCH, including translucent overlays). */
function translucent(color: string | undefined): string | undefined {
	if (!color) return undefined;
	return `color-mix(in oklch, ${color} 24%, transparent)`;
}

function styleAttr(state: SgrState): string {
	const fg = state.inverse ? (state.bg ?? "var(--surface-base)") : state.fg;
	const bg = state.inverse ? (state.fg ?? "var(--text)") : state.bg;
	const declarations: string[] = [];
	if (fg) declarations.push(`color:${fg}`);
	if (bg) declarations.push(`background-color:${bg}`);
	if (state.bold) declarations.push("font-weight:600");
	if (state.dim) declarations.push("opacity:0.65");
	if (state.italic) declarations.push("font-style:italic");
	if (state.underline && state.strikethrough) {
		declarations.push("text-decoration:underline line-through");
	} else if (state.underline) declarations.push("text-decoration:underline");
	else if (state.strikethrough) declarations.push("text-decoration:line-through");
	return declarations.length > 0 ? ` style="${declarations.join(";")}"` : "";
}

function isStylePlain(state: SgrState): boolean {
	return (
		!state.bold &&
		!state.dim &&
		!state.italic &&
		!state.underline &&
		!state.inverse &&
		!state.strikethrough &&
		state.fg === undefined &&
		state.bg === undefined
	);
}

const escapeSequence =
	// oxlint-disable-next-line no-control-regex -- ANSI escapes are control characters by definition.
	/\x1b(?:\[([0-9;]*)([A-Za-z@])|\]8;[^;]*;([^\x07\x1b]*)(?:\x07|\x1b\\)|[^[\]])/g;

export type AnsiRenderedLine = {
	/** Pre-escaped, safe HTML for this line's content (no wrapping element). */
	html: string;
	/** 0-based column of the `CURSOR_MARKER`, if this line carried one. */
	cursorColumn?: number;
};

/**
 * Converts one ANSI-styled line into safe HTML. Text runs are HTML-escaped;
 * only the `style` attributes this module generates are ever emitted as raw
 * markup — no part of the extension's own output is trusted as HTML.
 */
export function ansiLineToHtml(line: string): AnsiRenderedLine {
	let withoutCursor = line;
	let cursorColumn: number | undefined;
	const markerIndex = line.indexOf(cursorMarker);
	if (markerIndex >= 0) {
		withoutCursor =
			line.slice(0, markerIndex) + line.slice(markerIndex + cursorMarker.length);
	}

	let html = "";
	let state = freshState();
	let openStyled = false;
	let openLink: string | undefined;
	let lastIndex = 0;
	escapeSequence.lastIndex = 0;

	const closeStyled = () => {
		if (openStyled) {
			html += "</span>";
			openStyled = false;
		}
	};
	const closeLink = () => {
		closeStyled();
		if (openLink !== undefined) {
			html += "</a>";
			openLink = undefined;
		}
	};
	const emitText = (text: string) => {
		if (text.length === 0) return;
		if (!openStyled && !isStylePlain(state)) {
			html += `<span${styleAttr(state)}>`;
			openStyled = true;
		} else if (openStyled && isStylePlain(state)) {
			html += "</span>";
			openStyled = false;
		}
		html += escapeHtml(text);
	};

	let match: RegExpExecArray | null;
	while ((match = escapeSequence.exec(withoutCursor))) {
		const [full, csiParams, csiFinal, osc8Uri] = match;
		if (match.index > lastIndex) {
			emitText(withoutCursor.slice(lastIndex, match.index));
		}
		lastIndex = match.index + full.length;
		if (csiFinal === "m") {
			const params = (csiParams ?? "")
				.split(";")
				.filter((part) => part.length > 0)
				.map((part) => Number.parseInt(part, 10));
			closeStyled();
			applySgr(state, params);
		} else if (osc8Uri !== undefined) {
			closeLink();
			if (osc8Uri.length > 0 && isSafeLinkTarget(osc8Uri)) {
				html += `<a href="${escapeHtml(osc8Uri)}" target="_blank" rel="noreferrer">`;
				openLink = osc8Uri;
			}
		}
		// Any other CSI (cursor movement, erase, …) or bare ESC sequence is
		// dropped: `render()` lines are a fixed grid, not a live stream.
	}
	if (lastIndex < withoutCursor.length) emitText(withoutCursor.slice(lastIndex));
	closeLink();

	if (markerIndex >= 0) {
		// Re-derive the cursor's visible column from the marker's position in
		// the ORIGINAL string, counting visible (non-escape, non-marker)
		// characters up to it — matching how `column` above only advances for
		// emitted text, not escape sequences.
		cursorColumn = visibleColumnAt(line, markerIndex);
	}

	return { html, cursorColumn };
}

/** Counts visible characters (outside ANSI escapes) before `index` in the original line. */
function visibleColumnAt(line: string, index: number): number {
	let column = 0;
	let cursor = 0;
	// oxlint-disable-next-line no-control-regex -- ANSI escapes are control characters by definition.
	const pattern = /\x1b(?:\[[0-9;]*[A-Za-z@]|\][^\x07\x1b]*(?:\x07|\x1b\\)|[^[\]])/g;
	while (cursor < index) {
		pattern.lastIndex = cursor;
		const match = pattern.exec(line);
		if (match && match.index === cursor) {
			cursor += match[0].length;
			continue;
		}
		const char = line[cursor] ?? "";
		column += 1;
		cursor += char.length;
	}
	return column;
}

/** OSC 8 URIs are extension-controlled; only allow schemes a browser can safely open. */
function isSafeLinkTarget(uri: string): boolean {
	return (
		uri.startsWith("https://") ||
		uri.startsWith("http://") ||
		uri.startsWith("mailto:")
	);
}
