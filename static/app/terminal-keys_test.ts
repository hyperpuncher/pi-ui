import { test } from "bun:test";

import { assertEquals, assertNotEquals, waitForCondition } from "#testing/assertions";

import { endpoints } from "../../src/server/routes/endpoints.ts";
import {
	bindTerminalSurfaces,
	encodeKeyEvent,
	measurePromptColumnCells,
	measureTranscriptRenderCells,
	restoreFocusAfterSurfaceUnmount,
} from "./terminal-keys.js";

function key(
	value: string,
	modifiers: Partial<{ ctrlKey: boolean; altKey: boolean; shiftKey: boolean }> = {},
) {
	return { key: value, ctrlKey: false, altKey: false, shiftKey: false, ...modifiers };
}

test("terminal keys encode editing and navigation keys as xterm sequences", () => {
	assertEquals(encodeKeyEvent(key("Enter")), "\r");
	assertEquals(encodeKeyEvent(key("Escape")), "\u001b");
	assertEquals(encodeKeyEvent(key("Backspace")), "\u007f");
	assertEquals(encodeKeyEvent(key("Tab")), "\t");
	assertEquals(encodeKeyEvent(key("Tab", { shiftKey: true })), "\u001b[Z");
	assertEquals(encodeKeyEvent(key("ArrowUp")), "\u001b[A");
	assertEquals(encodeKeyEvent(key("ArrowLeft", { ctrlKey: true })), "\u001b[1;5D");
	assertEquals(encodeKeyEvent(key("PageDown")), "\u001b[6~");
	assertEquals(encodeKeyEvent(key("Delete", { shiftKey: true })), "\u001b[3;2~");
	assertEquals(encodeKeyEvent(key("Home")), "\u001b[H");
});

test("terminal keys fall back to xterm's modifyOtherKeys form for otherwise-unencodable chords", () => {
	// Ctrl+Enter/Ctrl+Tab have no simpler legacy encoding pi-tui's parser accepts.
	assertEquals(encodeKeyEvent(key("Enter", { ctrlKey: true })), "\u001b[27;5;13~");
	assertEquals(encodeKeyEvent(key("Tab", { ctrlKey: true })), "\u001b[27;5;9~");
	assertEquals(
		encodeKeyEvent(key(" ", { ctrlKey: true, altKey: true })),
		"\u001b[27;7;32~",
	);
});

test("terminal keys encode printable text, Ctrl and Alt chords", () => {
	assertEquals(encodeKeyEvent(key("a")), "a");
	assertEquals(encodeKeyEvent(key("Z", { shiftKey: true })), "Z");
	assertEquals(encodeKeyEvent(key("c", { ctrlKey: true })), "\u0003");
	assertEquals(encodeKeyEvent(key("x", { altKey: true })), "\u001bx");
	assertEquals(encodeKeyEvent(key(" ", { ctrlKey: true })), "\u0000");
	assertEquals(encodeKeyEvent(key(" ", { altKey: true })), "\u001b ");
});

test("terminal keys leave bare modifiers and unsupported function keys to the browser", () => {
	assertEquals(encodeKeyEvent(key("Shift", { shiftKey: true })), null);
	assertEquals(encodeKeyEvent(key("F5")), null);
	assertEquals(encodeKeyEvent(key("Escape", { shiftKey: true })), null);
});

/**
 * O11: `bindTerminalSurfaces()`'s cell-grid re-fit (F3: an already-mounted grid whose
 * `data-cols`/`data-rows` reset, and a real resize/rotate) was previously verified only by
 * browser probes. A hand-rolled fake DOM — not a real browser engine — is enough to exercise
 * the exact code paths (`measureCell`, `sendResize`, the attribute-watching `MutationObserver`,
 * and `ResizeObserver`), the same style this codebase already uses for `history-stack_test.ts`'s
 * bind-layer tests; this module has no shared singleton state with that one.
 */
class FakeGridElement {
	dataset: Record<string, string> = {};
	clientWidth = 0;
	computedStyle = {
		paddingInlineStart: "0px",
		paddingInlineEnd: "0px",
		lineHeight: "20px",
	};
	style: Record<string, string> = {};
	textContent = "";
	#rect: { width: number; height: number };
	#closest: FakeGridElement | null = null;
	#query: FakeGridElement | null = null;

	constructor(rect: { width: number; height: number }) {
		this.#rect = rect;
	}
	getBoundingClientRect() {
		return this.#rect;
	}
	setRect(rect: { width: number; height: number }) {
		this.#rect = rect;
	}
	closest() {
		return this.#closest;
	}
	setClosest(target: FakeGridElement | null) {
		this.#closest = target;
	}
	querySelector() {
		return this.#query;
	}
	setQueryResult(target: FakeGridElement | null) {
		this.#query = target;
	}
	setAttribute() {}
}

/**
 * Patches a global via `Object.defineProperty` rather than plain assignment: another test file
 * (`file-transfer_test.ts`) leaves a `configurable: true, writable: false` `ResizeObserver` on
 * `globalThis` for the rest of the process, and a plain `globalThis.ResizeObserver = …` throws
 * against that. Returns a restore function that puts back whatever was there before — the
 * original descriptor if one existed, or removes the property if it didn't — the same pattern
 * `file-transfer_test.ts`'s own `restoreGlobal` uses.
 */
function patchGlobal(name: string, value: unknown): () => void {
	const original = Object.getOwnPropertyDescriptor(globalThis, name);
	Object.defineProperty(globalThis, name, {
		configurable: true,
		writable: true,
		value,
	});
	return () => {
		if (original) Object.defineProperty(globalThis, name, original);
		else Reflect.deleteProperty(globalThis, name);
	};
}

/** Installs the fake globals `bindTerminalSurfaces()` touches; returns a restore function. */
function installFakeDom(options: {
	probeRect: { width: number; height: number };
	grids: FakeGridElement[];
	resizeObserver?: boolean;
	/** `document.documentElement.clientWidth` — only read for a percentage-width overlay (F4). */
	documentElementWidth?: number;
}) {
	const calls: Array<{ url: string; body: unknown }> = [];
	let mutationCallback: ((mutations: unknown[]) => void) | undefined;
	let resizeCallback: ((entries: Array<{ target: unknown }>) => void) | undefined;
	let windowResizeCallback: (() => void) | undefined;

	const restores = [
		patchGlobal("Element", FakeGridElement),
		patchGlobal(
			"MutationObserver",
			class {
				constructor(cb: (mutations: unknown[]) => void) {
					mutationCallback = cb;
				}
				observe() {}
				disconnect() {}
			},
		),
		...(options.resizeObserver
			? [
					patchGlobal(
						"ResizeObserver",
						class {
							constructor(
								cb: (entries: Array<{ target: unknown }>) => void,
							) {
								resizeCallback = cb;
							}
							observe() {}
							disconnect() {}
						},
					),
				]
			: []),
		patchGlobal("getComputedStyle", (el: FakeGridElement) => el.computedStyle),
		patchGlobal("fetch", async (url: string, init: { body: string }) => {
			calls.push({ url, body: JSON.parse(init.body) });
			return new Response("");
		}),
		patchGlobal("document", {
			getElementById: (id: string) =>
				id === "terminal-surface-persistent" ? {} : undefined,
			createElement: () => new FakeGridElement(options.probeRect),
			documentElement: { clientWidth: options.documentElementWidth ?? 0 },
			body: { appendChild: () => {}, removeChild: () => {} },
			head: { appendChild: () => {} },
			addEventListener: () => {},
			querySelectorAll: () => options.grids,
		}),
		patchGlobal("window", {
			addEventListener: (name: string, cb: () => void) => {
				if (name === "resize") windowResizeCallback = cb;
			},
		}),
	];

	return {
		calls,
		getMutationCallback: () => mutationCallback,
		getResizeCallback: () => resizeCallback,
		getWindowResizeCallback: () => windowResizeCallback,
		restore: () => {
			for (const restore of restores) restore();
		},
	};
}

// This test MUST run before any other test in this file that calls `bindTerminalSurfaces()`:
// `ensureResizeObserver()` in terminal-keys.js caches its `ResizeObserver` instance in a
// module-level singleton the first time anything calls it (mirroring how `resizeObserver` is
// never re-created); whichever `ResizeObserver` class is installed at that first call wins for
// the rest of the process. `file-transfer_test.ts` installs its own inert one at import time
// (also process-wide), so this test installs its capturing one and calls `bindTerminalSurfaces`
// first, before that inert one can ever be the one constructed.
test("a mounted surface re-fits through ResizeObserver when its grid is resized or rotated (O11)", async () => {
	const grid = new FakeGridElement({ width: 0, height: 480 });
	grid.dataset.terminalSurfaceGrid = "s-resize";
	const body = new FakeGridElement({ width: 0, height: 0 });
	body.dataset.cols = "80";
	body.dataset.rows = "24";
	body.clientWidth = 700;
	grid.setQueryResult(body);

	const dom = installFakeDom({
		probeRect: { width: 140, height: 20 },
		grids: [grid],
		resizeObserver: true,
	});
	try {
		bindTerminalSurfaces();
		await waitForCondition(() => dom.calls.length >= 1, {
			timeoutMs: 1000,
			message: "expected a resize POST when the surface first mounted",
		});
		assertEquals(dom.calls[0]?.body, { surfaceId: "s-resize", cols: 100, rows: 24 });

		const resizeCallback = dom.getResizeCallback();
		assertNotEquals(resizeCallback, undefined);
		// A rotate/viewport resize shrinks the grid's own box; ResizeObserver reports it.
		grid.setRect({ width: 0, height: 200 });
		resizeCallback?.([{ target: grid }]);

		await waitForCondition(() => dom.calls.length >= 2, {
			timeoutMs: 1000,
			message: "expected a second resize POST after the grid's box changed",
		});
		assertEquals(dom.calls[1]?.body, { surfaceId: "s-resize", cols: 100, rows: 10 });
	} finally {
		dom.restore();
	}
});

test("a window resize re-fits every mounted surface even when its own grid box didn't change (F4)", async () => {
	// An overlay's box is sized in `ch`/`dvh` from its last resolved column/row count
	// (`overlayStyleVars`), so widening or narrowing the browser window alone never changes the
	// grid element's own size — the ResizeObserver the other test above exercises has nothing to
	// fire on. Only a `window` "resize" listener catches this case.
	const grid = new FakeGridElement({ width: 0, height: 480 });
	grid.dataset.terminalSurfaceGrid = "s-window-resize";
	const body = new FakeGridElement({ width: 0, height: 0 });
	body.dataset.cols = "80";
	body.dataset.rows = "24";
	body.clientWidth = 700;
	grid.setQueryResult(body);

	const dom = installFakeDom({
		probeRect: { width: 140, height: 20 },
		grids: [grid],
		resizeObserver: true,
	});
	try {
		bindTerminalSurfaces();
		await waitForCondition(() => dom.calls.length >= 1, {
			timeoutMs: 1000,
			message: "expected a resize POST when the surface first mounted",
		});

		const windowResizeCallback = dom.getWindowResizeCallback();
		assertNotEquals(windowResizeCallback, undefined);
		// The grid's own box (`getBoundingClientRect`) is left exactly as it was — only the
		// window "resize" event fires, and a wider body box simulates the page's own layout
		// (not the grid) reacting to the new window size.
		body.clientWidth = 900;
		windowResizeCallback?.();

		await waitForCondition(() => dom.calls.length >= 2, {
			timeoutMs: 1000,
			message: "expected a second resize POST after a bare window resize",
		});
		assertEquals(dom.calls[1]?.body, {
			surfaceId: "s-window-resize",
			cols: 128,
			rows: 24,
		});
	} finally {
		dom.restore();
	}
});

test("a re-mounted persistent surface re-fits when the server resets its data-cols/data-rows (F3/O11)", async () => {
	const grid = new FakeGridElement({ width: 0, height: 400 });
	grid.dataset.terminalSurfaceGrid = "s-attrs";
	const body = new FakeGridElement({ width: 0, height: 0 });
	body.dataset.cols = "80";
	body.dataset.rows = "24";
	body.clientWidth = 700;
	grid.setQueryResult(body);
	body.setClosest(grid);

	const dom = installFakeDom({ probeRect: { width: 140, height: 20 }, grids: [] });
	try {
		bindTerminalSurfaces();
		const mutationCallback = dom.getMutationCallback();
		assertNotEquals(mutationCallback, undefined);
		// Mirrors the server resetting a re-mounted grid to its default size (setWidget called
		// again, /reload, a session switch): only the data-cols/data-rows attributes change.
		mutationCallback?.([
			{ type: "attributes", target: body, addedNodes: [], removedNodes: [] },
		]);

		await waitForCondition(() => dom.calls.length > 0, {
			timeoutMs: 1000,
			message: "expected a resize POST after data-cols/data-rows changed",
		});
		assertEquals(dom.calls[0]?.url, endpoints.terminalSurfaceResize);
		assertEquals(dom.calls[0]?.body, { surfaceId: "s-attrs", cols: 100, rows: 20 });
	} finally {
		dom.restore();
	}
});

test("focus returns to the prompt when a focused overlay or inline surface unmounts", () => {
	class FakeNode {
		constructor(private readonly classes: string[]) {}
		matches(selector: string) {
			return selector
				.split(",")
				.some((part) => this.classes.includes(part.trim().replace(/^\./, "")));
		}
		querySelector() {
			return null;
		}
	}
	interface FakeDocument {
		body: object;
		activeElement: object;
		getElementById(id: string): { focus(): void } | null;
	}
	let focused = 0;
	const body = {};
	const fakeDocument: FakeDocument = {
		body,
		activeElement: body,
		getElementById: (id: string) =>
			id === "prompt-input" ? { focus: () => (focused += 1) } : null,
	};
	const restores = [
		patchGlobal("Element", FakeNode),
		patchGlobal("document", fakeDocument),
	];
	try {
		restoreFocusAfterSurfaceUnmount([
			new FakeNode(["dialog", "terminal-surface-dialog"]),
		]);
		assertEquals(focused, 1);
		restoreFocusAfterSurfaceUnmount([
			new FakeNode(["terminal-surface", "terminal-surface-inline"]),
		]);
		assertEquals(focused, 2);
		// A persistent widget unmounting must not pull focus (it never held it).
		restoreFocusAfterSurfaceUnmount([
			new FakeNode(["terminal-surface", "terminal-surface-widget"]),
		]);
		assertEquals(focused, 2);
		// Focus that already moved somewhere real is left alone.
		fakeDocument.activeElement = { id: "somewhere" };
		restoreFocusAfterSurfaceUnmount([
			new FakeNode(["dialog", "terminal-surface-dialog"]),
		]);
		assertEquals(focused, 2);
	} finally {
		for (const restore of restores) restore();
	}
});

test("an overlay reports the rows its dialog can grow to, not the rows it currently shows", async () => {
	// A component that sizes itself from `terminal.rows` (ask_user's overlay) must not see the
	// few rows its own short first render occupies, or it renders a "too short" stub forever.
	const content = new FakeGridElement({ width: 700, height: 130 });
	Object.assign(content.computedStyle, { maxHeight: "600px" });
	const grid = new FakeGridElement({ width: 0, height: 96 });
	grid.dataset.terminalSurfaceGrid = "s-overlay";
	grid.dataset.terminalSurfaceKind = "overlay";
	grid.setClosest(content);
	const body = new FakeGridElement({ width: 0, height: 0 });
	body.dataset.cols = "80";
	body.dataset.rows = "4";
	body.clientWidth = 700;
	grid.setQueryResult(body);
	body.setClosest(grid);

	const dom = installFakeDom({ probeRect: { width: 140, height: 20 }, grids: [] });
	try {
		bindTerminalSurfaces();
		dom.getMutationCallback()?.([
			{ type: "attributes", target: body, addedNodes: [], removedNodes: [] },
		]);
		await waitForCondition(() => dom.calls.length > 0, {
			timeoutMs: 1000,
			message: "expected a resize POST for the overlay",
		});
		// 600px max-height minus 34px of dialog chrome, at 20px rows.
		assertEquals(dom.calls[0]?.body, { surfaceId: "s-overlay", cols: 100, rows: 28 });
	} finally {
		dom.restore();
	}
});

test("a percentage-width overlay measures against the viewport, not its own already-sized box (F4)", async () => {
	// The dialog is now sized to exactly fit the already-resolved column count
	// (`terminal-surface.tsx`'s `overlayStyleVars`), so measuring it directly and feeding it
	// back as `cols` would resolve `OverlayOptions.width`'s percentage a second time — each
	// pass narrowing further with no floor, instead of the ~8% gap the un-narrowed box used to
	// leave. `data-terminal-surface-percent-width` (set only for a `N%` width) routes this
	// measurement through the viewport instead, the same reference the percentage was already
	// resolved against server-side.
	const content = new FakeGridElement({ width: 700, height: 130 });
	const grid = new FakeGridElement({ width: 0, height: 96 });
	grid.dataset.terminalSurfaceGrid = "s-percent";
	grid.dataset.terminalSurfaceKind = "overlay";
	grid.dataset.terminalSurfacePercentWidth = "true";
	grid.setClosest(content);
	const body = new FakeGridElement({ width: 0, height: 0 });
	body.dataset.cols = "80";
	body.dataset.rows = "24";
	// The box's own (already 92%-resolved) content width — the old bug's reference.
	body.clientWidth = 644;
	grid.setQueryResult(body);
	body.setClosest(grid);

	const dom = installFakeDom({
		probeRect: { width: 140, height: 20 },
		grids: [],
		documentElementWidth: 1400,
	});
	try {
		bindTerminalSurfaces();
		dom.getMutationCallback()?.([
			{ type: "attributes", target: body, addedNodes: [], removedNodes: [] },
		]);
		await waitForCondition(() => dom.calls.length > 0, {
			timeoutMs: 1000,
			message: "expected a resize POST for the percentage overlay",
		});
		// (1400 viewport - 56 chrome) / 7px cells = 192 cols — not ~92 (644 / 7), which is what
		// re-measuring the already-narrowed box would have produced.
		assertEquals(dom.calls[0]?.body, { surfaceId: "s-percent", cols: 192, rows: 4 });
	} finally {
		dom.restore();
	}
});

test("a percentage-width overlay shrinks to a narrowed viewport instead of keeping its old box (F4)", async () => {
	// After the window narrows, the box is still sized for the old, wider viewport: flooring
	// the reference at that box kept the overlay wider than the new viewport.
	const content = new FakeGridElement({ width: 1762, height: 130 });
	const grid = new FakeGridElement({ width: 0, height: 96 });
	grid.dataset.terminalSurfaceGrid = "s-narrowed";
	grid.dataset.terminalSurfaceKind = "overlay";
	grid.dataset.terminalSurfacePercentWidth = "true";
	grid.setClosest(content);
	const body = new FakeGridElement({ width: 0, height: 0 });
	body.dataset.cols = "244";
	body.dataset.rows = "24";
	body.clientWidth = 1726;
	grid.setQueryResult(body);
	body.setClosest(grid);

	const dom = installFakeDom({
		probeRect: { width: 140, height: 20 },
		grids: [],
		documentElementWidth: 768,
	});
	try {
		bindTerminalSurfaces();
		dom.getMutationCallback()?.([
			{ type: "attributes", target: body, addedNodes: [], removedNodes: [] },
		]);
		await waitForCondition(() => dom.calls.length > 0, {
			timeoutMs: 1000,
			message: "expected a resize POST for the narrowed percentage overlay",
		});
		// (768 viewport - 36 chrome) / 7px cells = 104 cols, not the old box's 246.
		assertEquals(dom.calls[0]?.body, { surfaceId: "s-narrowed", cols: 104, rows: 4 });
	} finally {
		dom.restore();
	}
});

test("a numeric-width overlay still measures its own box (only a percentage needs the viewport)", async () => {
	const content = new FakeGridElement({ width: 700, height: 130 });
	const grid = new FakeGridElement({ width: 0, height: 96 });
	grid.dataset.terminalSurfaceGrid = "s-numeric";
	grid.dataset.terminalSurfaceKind = "overlay";
	grid.setClosest(content);
	const body = new FakeGridElement({ width: 0, height: 0 });
	body.dataset.cols = "80";
	body.dataset.rows = "24";
	body.clientWidth = 560;
	grid.setQueryResult(body);
	body.setClosest(grid);

	const dom = installFakeDom({
		probeRect: { width: 140, height: 20 },
		grids: [],
		documentElementWidth: 1400,
	});
	try {
		bindTerminalSurfaces();
		dom.getMutationCallback()?.([
			{ type: "attributes", target: body, addedNodes: [], removedNodes: [] },
		]);
		await waitForCondition(() => dom.calls.length > 0, {
			timeoutMs: 1000,
			message: "expected a resize POST for the numeric-width overlay",
		});
		// 560 / 7px cells = 80 cols, ignoring the (irrelevant, much larger) viewport reference.
		assertEquals(dom.calls[0]?.body, { surfaceId: "s-numeric", cols: 80, rows: 4 });
	} finally {
		dom.restore();
	}
});

test("a percentage-width overlay stops answering back another tab's smaller size", async () => {
	// Two tabs share one surface size. This tab measures its own width (768px viewport); a
	// narrower tab keeps reporting its own smaller size. Re-reporting ours on every change
	// flipped the overlay between the two sizes forever.
	const content = new FakeGridElement({ width: 700, height: 130 });
	const grid = new FakeGridElement({ width: 0, height: 96 });
	grid.dataset.terminalSurfaceGrid = "s-two-tabs";
	grid.dataset.terminalSurfaceKind = "overlay";
	grid.dataset.terminalSurfacePercentWidth = "true";
	grid.setClosest(content);
	const body = new FakeGridElement({ width: 0, height: 0 });
	body.dataset.cols = "100";
	body.dataset.rows = "24";
	body.clientWidth = 732;
	grid.setQueryResult(body);
	body.setClosest(grid);

	const dom = installFakeDom({
		probeRect: { width: 140, height: 20 },
		grids: [],
		documentElementWidth: 768,
	});
	const settle = () => new Promise((resolve) => setTimeout(resolve, 200));
	const changed = () =>
		dom.getMutationCallback()?.([
			{ type: "attributes", target: body, addedNodes: [], removedNodes: [] },
		]);
	try {
		bindTerminalSurfaces();
		changed();
		await waitForCondition(() => dom.calls.length > 0, {
			timeoutMs: 1000,
			message: "expected the first resize POST",
		});
		const first = dom.calls[0]?.body as { cols: number };
		assertEquals(first.cols > 43, true);
		// The other tab's smaller size lands: nothing is sent back.
		body.dataset.cols = "43";
		body.dataset.rows = "4";
		changed();
		await settle();
		assertEquals(dom.calls.length, 1);
		// A size larger than this tab can show is corrected, keeping the other tab's smaller
		// dimension: a wider but shorter tab and a narrower but taller one settle on the
		// smaller of each instead of trading sizes.
		body.dataset.cols = "158";
		body.dataset.rows = "3";
		changed();
		await waitForCondition(() => dom.calls.length > 1, {
			timeoutMs: 1000,
			message: "expected a resize POST for a too-wide shared size",
		});
		assertEquals(dom.calls[1]?.body, {
			surfaceId: "s-two-tabs",
			cols: first.cols,
			rows: 3,
		});
		// That settled size is left alone.
		body.dataset.cols = String(first.cols);
		changed();
		await settle();
		assertEquals(dom.calls.length, 2);
	} finally {
		dom.restore();
	}
});

// R7-B item 2: `measurePromptColumnCells` — the client's own measured `#prompt-box` width, used
// to seed a prompt-column surface's (inline/widget/footer/header) first frame more accurately
// than the whole viewport (see `TerminalSurfaceController`'s `promptColumns` use).
test("the prompt-column hint is measured from #prompt-box's own padded width", () => {
	const box = new FakeGridElement({ width: 0, height: 0 });
	box.clientWidth = 800;
	box.computedStyle = {
		paddingInlineStart: "16px",
		paddingInlineEnd: "16px",
		lineHeight: "20px",
	};
	const restore = patchGlobal("document", {
		getElementById: (id: string) => (id === "prompt-box" ? box : undefined),
	});
	const restoreStyle = patchGlobal(
		"getComputedStyle",
		(el: FakeGridElement) => el.computedStyle,
	);
	try {
		// (800 - 32) available px / 7px cells = 109 cols.
		assertEquals(measurePromptColumnCells({ width: 7, height: 14 }), 109);
	} finally {
		restore();
		restoreStyle();
	}
});

test("the prompt-column hint subtracts a surface's own chrome and a scrollbar gutter", () => {
	const box = new FakeGridElement({ width: 0, height: 0 });
	box.clientWidth = 900;
	box.computedStyle = { paddingInlineStart: "0px", paddingInlineEnd: "0px" };
	const appended: string[] = [];
	let removed = 0;
	const host = {
		appendChild: (el: { className: string }) => appended.push(el.className),
	};
	const element = (tag: string) => ({
		className: "",
		style: { cssText: "" },
		// The replica body: the surface's grid border and the body's own box sit inside the host.
		clientWidth: tag === "pre" ? 780 : 0,
		computedStyle:
			tag === "pre" ? { paddingInlineStart: "10px", paddingInlineEnd: "10px" } : {},
		setAttribute() {},
		appendChild() {},
		remove: () => {
			removed += 1;
		},
	});
	const restore = patchGlobal("document", {
		documentElement: { computedStyle: {} },
		getElementById: (id: string) =>
			id === "prompt-box"
				? box
				: id === "terminal-surface-persistent"
					? { parentElement: host }
					: undefined,
		createElement: element,
	});
	const restoreStyle = patchGlobal(
		"getComputedStyle",
		(el: { computedStyle?: Record<string, string> }) => ({
			...el.computedStyle,
			getPropertyValue: (name: string) =>
				name === "--terminal-scrollbar-size" ? "15px" : "",
		}),
	);
	try {
		// (780 - 20 padding - 15 gutter) px / 7px cells = 106 cols, not the box's 900 / 7 = 128.
		assertEquals(measurePromptColumnCells({ width: 7, height: 14 }), 106);
		assertEquals(appended, ["terminal-surface terminal-surface-widget"]);
		assertEquals(removed, 1);
	} finally {
		restore();
		restoreStyle();
	}
});

test("the prompt-column hint is undefined before #prompt-box exists in the DOM", () => {
	const restore = patchGlobal("document", { getElementById: () => undefined });
	try {
		assertEquals(measurePromptColumnCells({ width: 7, height: 14 }), undefined);
	} finally {
		restore();
	}
});

// R7-B item 1: a resize report now carries this tab's display client id, so
// `TerminalSurfaceController` can size a persistent surface at the narrowest of every tab
// currently reporting one instead of whichever tab's report landed last.
test("a resize report carries this tab's display client id when the page has one", async () => {
	const grid = new FakeGridElement({ width: 0, height: 480 });
	grid.dataset.terminalSurfaceGrid = "s-client-id";
	const body = new FakeGridElement({ width: 0, height: 0 });
	body.dataset.cols = "80";
	body.dataset.rows = "24";
	body.clientWidth = 700;
	grid.setQueryResult(body);

	const dom = installFakeDom({
		probeRect: { width: 140, height: 20 },
		grids: [grid],
		resizeObserver: true,
	});
	// `installFakeDom`'s fake `document.body` has no `dataset` of its own; give it one, the
	// same way `page.tsx` embeds this tab's id as `data-display-client-id`.
	(document.body as unknown as { dataset: Record<string, string> }).dataset = {
		displayClientId: "tab-a",
	};
	try {
		bindTerminalSurfaces();
		await waitForCondition(() => dom.calls.length >= 1, {
			timeoutMs: 1000,
			message: "expected a resize POST when the surface first mounted",
		});
		assertEquals(dom.calls[0]?.body, {
			surfaceId: "s-client-id",
			cols: 100,
			rows: 24,
			clientId: "tab-a",
		});
	} finally {
		dom.restore();
	}
});

// Custom message/entry renders (R7-A) are sized from a replica of the transcript card.
test("the transcript render width is measured from a removed replica of the custom render card", () => {
	type FakeNode = {
		tag: string;
		className: string;
		style: Record<string, string>;
		textContent: string;
		children: FakeNode[];
		clientWidth: number;
		removed: boolean;
		setAttribute(): void;
		appendChild(child: FakeNode): FakeNode;
		append(...nodes: FakeNode[]): void;
		getBoundingClientRect(): { width: number };
		remove(): void;
	};
	const node = (tag: string): FakeNode => ({
		tag,
		className: "",
		style: {},
		textContent: "",
		children: [],
		clientWidth: 0,
		removed: false,
		setAttribute() {},
		appendChild(child) {
			this.children.push(child);
			return child;
		},
		append(...nodes) {
			this.children.push(...nodes);
		},
		// 20 glyphs 160px wide: 8px per cell.
		getBoundingClientRect() {
			return { width: tag === "span" ? 160 : 0 };
		},
		remove() {
			this.removed = true;
		},
	});
	const created: FakeNode[] = [];
	const list = node("div");
	const restore = patchGlobal("document", {
		getElementById: (id: string) => (id === "message-list" ? list : undefined),
		createElement: (tag: string) => {
			const element = node(tag);
			// The card's content box: 750px, 8px glyphs -> 93 cells.
			if (tag === "div") element.clientWidth = 750;
			created.push(element);
			return element;
		},
	});
	const restoreStyle = patchGlobal("getComputedStyle", () => ({
		paddingInlineStart: "0px",
		paddingInlineEnd: "0px",
	}));
	try {
		assertEquals(measureTranscriptRenderCells(), 93);
		const article = created.find((entry) => entry.tag === "article");
		assertEquals(
			article?.className,
			"message message-context tool-timeline-item message-skill",
		);
		assertEquals(list.children[0], article);
		assertEquals(article?.removed, true);
		const render = created.find(
			(entry) => entry.className === "message-custom-render",
		);
		assertEquals(render?.style.overflowY, "scroll");
	} finally {
		restore();
		restoreStyle();
	}
});

test("the transcript render width is undefined before #message-list exists", () => {
	const restore = patchGlobal("document", { getElementById: () => undefined });
	try {
		assertEquals(measureTranscriptRenderCells(), undefined);
	} finally {
		restore();
	}
});
