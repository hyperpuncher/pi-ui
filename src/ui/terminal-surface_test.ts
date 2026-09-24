import { test } from "bun:test";

import {
	assertEquals,
	assertStringExcludes,
	assertStringIncludes,
} from "#testing/assertions";

import type { TerminalSurface } from "../agent/terminal-surface/types.ts";
import {
	renderTerminalSurfaceOverlays,
	renderTerminalSurfacePersistent,
	terminalSurfaceOverlayEffects,
} from "./terminal-surface.tsx";

function surface(overrides: Partial<TerminalSurface>): TerminalSurface {
	return {
		id: "s1",
		kind: "overlay",
		title: undefined,
		overlayOptions: undefined,
		belowEditor: false,
		lines: ['<span style="color:var(--status-error)">red</span>'],
		cursor: undefined,
		cols: 80,
		width: 80,
		rows: 24,
		revision: 1,
		...overrides,
	};
}

test("overlay surfaces render as focusable dialogs wired for key/paste/wheel/resize", () => {
	const html = renderTerminalSurfaceOverlays({
		terminalSurfaces: [surface({ title: "<b>Pick</b>" })],
	});
	assertStringIncludes(html, 'id="terminal-surface-overlays"');
	assertStringIncludes(html, '<dialog id="terminal-surface-s1"');
	assertStringIncludes(html, "&lt;b&gt;Pick&lt;/b&gt;");
	assertStringIncludes(html, 'data-terminal-surface-grid="s1"');
	assertStringIncludes(html, 'data-terminal-surface-input="s1"');
	assertStringIncludes(html, 'data-terminal-surface-keys="s1"');
	assertStringIncludes(html, "/extensions/terminal/input");
	// Line HTML is already escaped/styled by ansi-to-html and embedded verbatim.
	assertStringIncludes(html, '<span style="color:var(--status-error)">red</span>');
	assertEquals(terminalSurfaceOverlayEffects({ terminalSurfaces: [surface({})] }), [
		{ id: "terminal-surface-s1", modal: true },
	]);
});

test("a non-capturing overlay opens non-modally and never steals prompt focus", () => {
	assertEquals(
		terminalSurfaceOverlayEffects({
			terminalSurfaces: [surface({ overlayOptions: { nonCapturing: true } })],
		}),
		[{ id: "terminal-surface-s1", modal: false }],
	);
	const html = renderTerminalSurfaceOverlays({
		terminalSurfaces: [surface({ overlayOptions: { nonCapturing: true } })],
	});
	assertStringIncludes(html, 'data-nonblocking="true"');
});

test("overlay anchor and offset project onto the dialog's data attribute and style vars", () => {
	const html = renderTerminalSurfaceOverlays({
		terminalSurfaces: [
			surface({
				overlayOptions: {
					anchor: "top-right",
					offsetX: 2,
					offsetY: -1,
					width: 40,
					margin: 1,
				},
				// A numeric `width` is resolved to itself (unclamped) — see `tui-shim.ts`'s
				// `#resolveOverlayWidth`.
				width: 40,
			}),
		],
	});
	assertStringIncludes(html, 'data-anchor="top-right"');
	assertStringIncludes(html, "--terminal-overlay-offset-x:2ch");
	assertStringIncludes(html, "--terminal-overlay-offset-y:-1lh");
	assertStringIncludes(
		html,
		"--terminal-overlay-width:calc(40ch + var(--terminal-overlay-chrome))",
	);
	// Only a percentage width needs the viewport-based resize measurement (F4).
	assertStringExcludes(html, "data-terminal-surface-percent-width");
});

test("a percentage overlay width sizes the dialog to the already-resolved column count (F4)", () => {
	// `surface.width` is what `TerminalSurfaceController` already resolved "92%" against the
	// client-reported terminal size to (mirroring pi-tui's own overlay layout in `tui-shim.ts`).
	// Re-deriving `92vw` from the raw option here instead applied that percentage a *second*
	// time — once to size the box, once again (via `terminal-keys.js` measuring that box) to
	// size the content within it — leaving an ~8% gap on the right that never closed.
	const html = renderTerminalSurfaceOverlays({
		terminalSurfaces: [
			surface({
				overlayOptions: { width: "92%", maxHeight: "85%" },
				cols: 80,
				width: 73,
			}),
		],
	});
	assertStringIncludes(
		html,
		"--terminal-overlay-width:calc(73ch + var(--terminal-overlay-chrome))",
	);
	assertStringExcludes(html, "vw");
	assertStringIncludes(html, "--terminal-overlay-max-height:85dvh");
	// The client measures the viewport (not this now-exact-fit box) to re-resolve the
	// percentage on resize — see `terminal-keys.js`'s `percentOverlayAvailableWidth`.
	assertStringIncludes(html, 'data-terminal-surface-percent-width="true"');
});

test("an unrecognized anchor falls back to center rather than breaking the CSS selector", () => {
	const html = renderTerminalSurfaceOverlays({
		terminalSurfaces: [surface({ overlayOptions: { anchor: "north" } })],
	});
	assertStringIncludes(html, 'data-anchor="center"');
});

test("inline custom() surfaces and above-editor widgets render in the above host", () => {
	const html = renderTerminalSurfacePersistent(
		{
			terminalSurfaces: [
				surface({ id: "inline-1", kind: "inline" }),
				surface({ id: "widget:w", kind: "widget", belowEditor: false }),
				surface({ id: "head", kind: "header", belowEditor: false }),
				surface({ id: "o", kind: "overlay" }),
			],
		},
		"aboveEditor",
	);
	assertStringIncludes(html, 'id="terminal-surface-persistent"');
	assertStringIncludes(html, 'data-terminal-surface="inline-1"');
	assertStringIncludes(html, 'data-terminal-surface="widget:w"');
	assertStringIncludes(html, 'data-terminal-surface="head"');
	assertStringExcludes(html, 'data-terminal-surface="o"');
});

test("a footer, and a belowEditor widget, render in the below host instead (M3)", () => {
	const state = {
		terminalSurfaces: [
			surface({ id: "inline-1", kind: "inline" }),
			surface({ id: "foot", kind: "footer", belowEditor: true }),
			surface({ id: "widget:w", kind: "widget", belowEditor: true }),
			surface({ id: "head", kind: "header", belowEditor: false }),
		],
	};
	const above = renderTerminalSurfacePersistent(state, "aboveEditor");
	assertStringIncludes(above, 'id="terminal-surface-persistent"');
	assertStringIncludes(above, 'data-terminal-surface="inline-1"');
	assertStringIncludes(above, 'data-terminal-surface="head"');
	assertStringExcludes(above, 'data-terminal-surface="foot"');
	assertStringExcludes(above, 'data-terminal-surface="widget:w"');

	const below = renderTerminalSurfacePersistent(state, "belowEditor");
	assertStringIncludes(below, 'id="terminal-surface-persistent-below"');
	assertStringIncludes(below, 'data-terminal-surface="foot"');
	assertStringIncludes(below, 'data-terminal-surface="widget:w"');
	assertStringExcludes(below, 'data-terminal-surface="inline-1"');
	assertStringExcludes(below, 'data-terminal-surface="head"');
});

test("surfaces render a hidden input proxy, soft-key bar, and size overlays by the rendered width", () => {
	const overlay = renderTerminalSurfaceOverlays({
		terminalSurfaces: [surface({ cols: 159, width: 50 })],
	});
	assertStringIncludes(overlay, 'data-cols="159"');
	assertStringIncludes(overlay, 'class="terminal-surface-input"');
	assertStringIncludes(overlay, 'class="terminal-surface-keys"');

	const inline = renderTerminalSurfacePersistent(
		{ terminalSurfaces: [surface({ id: "inline-1", kind: "inline" })] },
		"aboveEditor",
	);
	assertStringIncludes(inline, 'data-terminal-surface-kind="inline"');
	assertStringIncludes(inline, 'data-terminal-surface-keys="inline-1"');
});

test("widget, header and footer surfaces never render a soft-key bar", () => {
	const state = {
		terminalSurfaces: [
			surface({ id: "w1", kind: "widget" }),
			surface({ id: "h1", kind: "header" }),
			surface({ id: "f1", kind: "footer", belowEditor: true }),
		],
	};
	const html =
		renderTerminalSurfacePersistent(state, "aboveEditor") +
		renderTerminalSurfacePersistent(state, "belowEditor");
	assertStringIncludes(html, 'data-terminal-surface-grid="w1"');
	assertStringIncludes(html, 'data-terminal-surface-grid="f1"');
	assertStringExcludes(html, "data-terminal-surface-keys");
});

test("persistent surfaces drop blank edge rows and skip surfaces with nothing visible", () => {
	const html = renderTerminalSurfacePersistent(
		{
			terminalSurfaces: [
				surface({
					id: "header",
					kind: "header",
					lines: ["", "   ", "<span> </span>"],
				}),
				surface({
					id: "widget:w",
					kind: "widget",
					lines: ["", "  ", "<span>body</span>", "  "],
					cursor: { row: 2, column: 1 },
				}),
			],
		},
		"aboveEditor",
	);
	assertStringExcludes(html, 'data-terminal-surface="header"');
	assertStringIncludes(html, 'data-terminal-surface="widget:w"');
	// Only the visible row survives: no blank rows before or after it inside the <pre>.
	assertStringIncludes(html, "><span>body</span></pre>");
	assertStringIncludes(html, "--terminal-cursor-row:0");
});

test("an overlay rendering nothing (e.g. stashed via setHidden) gets no dialog or open effect", () => {
	const hidden = surface({ lines: [], overlayOptions: { nonCapturing: true } });
	const blank = surface({ id: "s2", lines: ["   ", "<span> </span>"] });
	const state = { terminalSurfaces: [hidden, blank] };
	assertStringExcludes(renderTerminalSurfaceOverlays(state), "<dialog");
	assertEquals(terminalSurfaceOverlayEffects(state), []);
});
