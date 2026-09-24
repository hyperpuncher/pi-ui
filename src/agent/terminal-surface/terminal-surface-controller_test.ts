import { test } from "bun:test";

import type {
	Component,
	OverlayHandle,
	OverlayOptions,
	TUI,
} from "@earendil-works/pi-tui";

import { assertEquals, assertExists, assertStringIncludes } from "#testing/assertions";

import { TerminalSurfaceController } from "./terminal-surface-controller.ts";
import type { TerminalSurface } from "./types.ts";

/** Minimal `Component` fixture: renders fixed lines, no cached state to invalidate. */
function staticComponent(lines: string[] = []): Component {
	return { render: () => lines, invalidate: () => {} };
}

/**
 * A component whose `handleInput` forces a synchronous render (`tui.renderNow()`) — the same
 * pattern the "handleInput routes…" test below uses to observe a `resize()`'s effect
 * deterministically, since `resize()`/`forgetClient()` only ever schedule a coalesced
 * re-render (matching a real `Component`'s own `requestRender`), never force one.
 */
function nudgingComponent(tui: TUI, lines: string[]): Component {
	return {
		render: () => lines,
		invalidate: () => {},
		handleInput: () => tui.renderNow(),
	};
}

function makeController() {
	const updates: TerminalSurface[][] = [];
	const controller = new TerminalSurfaceController({
		onUpdate: (surfaces) => updates.push([...surfaces]),
	});
	return { controller, updates };
}

/**
 * `mountCustom()` mounts its component after `await factory(...)` resolves,
 * which (even for a synchronous factory) lands on a later microtask/macrotask
 * turn than the call that started it. Tests that need to inspect the mount
 * (or interact with it) before its returned promise ever settles flush the
 * queue first, rather than racing it.
 */
function flush(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

test("mountCustom (inline) renders the component and commits an initial frame", async () => {
	const { controller, updates } = makeController();
	let done: (result: string) => void = () => {};
	const promise = controller.mountCustom<string>({
		id: "inline-1",
		overlay: false,
		colorScheme: "dark",
		factory: (_tui, _theme, _keybindings, resolve) => {
			done = resolve;
			return staticComponent(["hello"]);
		},
	});
	await flush();

	const [surface] = controller.snapshot();
	assertExists(surface);
	assertEquals(surface.kind, "inline");
	assertStringIncludes(surface.lines.join("\n"), "hello");
	assertEquals(updates.length >= 1, true);

	done("picked");
	assertEquals(await promise, "picked");
	// done()/close() disposes the surface: it disappears from the snapshot.
	assertEquals(controller.snapshot(), []);
});

test("mountCustom (overlay) shows the component as an overlay and calls onHandle", async () => {
	const { controller } = makeController();
	let handle: OverlayHandle | undefined;
	const promise = controller.mountCustom<undefined>({
		id: "overlay-1",
		overlay: true,
		colorScheme: "dark",
		overlayOptions: { width: 40 },
		onHandle: (h) => {
			handle = h;
		},
		factory: (_tui, _theme, _keybindings, done) => ({
			render: () => ["overlay body"],
			handleInput: () => done(undefined),
			invalidate: () => {},
		}),
	});
	await flush();

	const [surface] = controller.snapshot();
	assertExists(surface);
	assertEquals(surface.kind, "overlay");
	assertEquals(surface.overlayOptions?.width, 40);
	assertExists(handle);

	controller.handleInput("overlay-1", "\r");
	assertEquals(await promise, undefined);
	assertEquals(controller.snapshot(), []);
});

test("handleInput routes to the mounted component and resize applies the client grid", async () => {
	const { controller } = makeController();
	const received: string[] = [];
	let component: Component | undefined;
	void controller.mountCustom({
		id: "surface-1",
		overlay: false,
		colorScheme: "dark",
		cols: 40,
		rows: 10,
		factory: (tui, _theme, _keybindings) => {
			component = {
				render: () => ["state"],
				handleInput: (data: string) => {
					received.push(data);
					// A real component asks for an immediate re-render after
					// mutating its own state; renderNow() forces a synchronous
					// commit so the test can observe it deterministically.
					tui.renderNow();
				},
				invalidate: () => {},
			};
			return component;
		},
	});
	await flush();
	assertExists(component);

	assertEquals(controller.handleInput("surface-1", "x"), true);
	assertEquals(received, ["x"]);
	assertEquals(controller.handleInput("unknown-id", "x"), false);

	const before = controller.snapshot()[0];
	assertExists(before);
	assertEquals(before.cols, 40);
	assertEquals(before.rows, 10);

	assertEquals(controller.resize("surface-1", { columns: 80, rows: 24 }), true);
	assertEquals(controller.resize("unknown-id", { columns: 80, rows: 24 }), false);
	// resize() only schedules a re-render (coalesced, like any other component-
	// driven update) — it does not force one. Nudge the same synchronous-
	// render path the earlier keystroke used to observe the new grid.
	controller.handleInput("surface-1", "y");
	const after = controller.snapshot()[0];
	assertExists(after);
	assertEquals(after.cols, 80);
	assertEquals(after.rows, 24);

	// The grid is client-measured, so an absurd size is clamped rather than applied.
	controller.resize("surface-1", { columns: 100_000, rows: 100_000 });
	controller.handleInput("surface-1", "z");
	const clamped = controller.snapshot()[0];
	assertExists(clamped);
	assertEquals(clamped.cols < 100_000 && clamped.rows < 100_000, true);

	controller.dispose("surface-1");
});

test("dispose resolves a pending custom() promise with undefined instead of hanging", async () => {
	const { controller } = makeController();
	const promise = controller.mountCustom<string>({
		id: "abandoned",
		overlay: false,
		colorScheme: "dark",
		factory: () => staticComponent(),
	});
	await flush();
	assertEquals(controller.snapshot().length, 1);
	// Simulates a session switch/reload aborting an outstanding custom() call.
	controller.dispose("abandoned");
	assertEquals(await promise, undefined);
	assertEquals(controller.snapshot(), []);
	// Disposing an already-disposed (or unknown) id is a no-op, not an error.
	controller.dispose("abandoned");
});

test("disposeAll tears down every mounted surface and resolves every pending promise", async () => {
	const { controller } = makeController();
	const first = controller.mountCustom<undefined>({
		id: "first",
		overlay: false,
		colorScheme: "dark",
		factory: () => staticComponent(),
	});
	const second = controller.mountCustom<undefined>({
		id: "second",
		overlay: true,
		colorScheme: "light",
		factory: () => staticComponent(),
	});
	controller.mountPersistent({
		id: "widget:example",
		kind: "widget",
		colorScheme: "dark",
		factory: () => staticComponent(["widget"]),
	});
	await flush();
	assertEquals(controller.snapshot().length, 3);

	controller.disposeAll();

	assertEquals(await first, undefined);
	assertEquals(await second, undefined);
	assertEquals(controller.snapshot(), []);
});

test("mountPersistent replaces an existing surface mounted under the same id", () => {
	const { controller } = makeController();
	controller.mountPersistent({
		id: "footer",
		kind: "footer",
		colorScheme: "dark",
		title: "first",
		factory: () => staticComponent(["first footer"]),
	});
	assertEquals(controller.snapshot().length, 1);
	assertStringIncludes(
		controller.snapshot()[0]?.lines.join("\n") ?? "",
		"first footer",
	);

	controller.mountPersistent({
		id: "footer",
		kind: "footer",
		colorScheme: "dark",
		title: "second",
		factory: () => staticComponent(["second footer"]),
	});
	assertEquals(controller.snapshot().length, 1);
	assertStringIncludes(
		controller.snapshot()[0]?.lines.join("\n") ?? "",
		"second footer",
	);

	controller.disposeAll();
});

test("a factory that throws resolves undefined and never leaves a mounted surface behind", async () => {
	const { controller } = makeController();
	const result = await controller.mountCustom<string>({
		id: "throws",
		overlay: false,
		colorScheme: "dark",
		factory: () => {
			throw new Error("boom");
		},
	});
	assertEquals(result, undefined);
	assertEquals(controller.snapshot(), []);
});

test("an overlay renders its component at the resolved overlay width, not the full grid", async () => {
	const { controller } = makeController();
	const widths: number[] = [];
	void controller.mountCustom({
		id: "sized",
		overlay: true,
		colorScheme: "dark",
		cols: 159,
		overlayOptions: { width: 50 },
		factory: () => ({
			render: (width: number) => {
				widths.push(width);
				return ["x"];
			},
			invalidate: () => {},
		}),
	});
	await flush();
	const [surface] = controller.snapshot();
	assertExists(surface);
	assertEquals(surface.cols, 159);
	assertEquals(surface.width, 50);
	assertEquals(widths.at(-1), 50);
	controller.disposeAll();
});

test("overlay options are sanitized before they reach the store", async () => {
	const { controller } = makeController();
	void controller.mountCustom<string>({
		id: "hostile",
		overlay: true,
		colorScheme: "dark",
		// SAFETY: simulates an extension ignoring the declared option types at runtime.
		overlayOptions: {
			width: "10px;background:url(x)",
			maxHeight: "50%",
			offsetX: Number.NaN,
			minWidth: "5;color:red",
		} as unknown as OverlayOptions,
		factory: () => staticComponent(["x"]),
	});
	await flush();
	const [surface] = controller.snapshot();
	assertExists(surface);
	assertEquals(surface.overlayOptions?.width, undefined);
	assertEquals(surface.overlayOptions?.maxHeight, "50%");
	assertEquals(surface.overlayOptions?.offsetX, undefined);
	assertEquals(surface.overlayOptions?.minWidth, undefined);
	controller.disposeAll();
});

test("a new overlay starts at the client's reported viewport width", async () => {
	const controller = new TerminalSurfaceController({
		onUpdate: () => {},
		viewportHint: () => ({ columns: 252, rows: 63 }),
	});
	void controller.mountCustom<string>({
		id: "overlay-hint",
		overlay: true,
		colorScheme: "dark",
		factory: () => staticComponent(["wide"]),
	});
	await flush();
	assertEquals(controller.snapshot()[0]?.cols, 252);
	controller.disposeAll();
});

test("a new prompt-column surface never starts wider than the default grid", async () => {
	const wide = new TerminalSurfaceController({
		onUpdate: () => {},
		viewportHint: () => ({ columns: 252, rows: 63 }),
	});
	void wide.mountCustom<string>({
		id: "inline-hint",
		overlay: false,
		colorScheme: "dark",
		factory: () => staticComponent(["inline"]),
	});
	wide.mountPersistent({
		id: "widget-hint",
		kind: "widget",
		colorScheme: "dark",
		title: undefined,
		factory: () => staticComponent(["widget"]),
	});
	await flush();
	assertEquals(
		wide.snapshot().map((surface) => surface.cols),
		[100, 100],
	);
	wide.disposeAll();

	// A phone's viewport is narrower than the default: that still wins.
	const narrow = new TerminalSurfaceController({
		onUpdate: () => {},
		viewportHint: () => ({ columns: 51, rows: 49 }),
	});
	narrow.mountPersistent({
		id: "footer-hint",
		kind: "footer",
		colorScheme: "dark",
		title: undefined,
		factory: () => staticComponent(["footer"]),
	});
	assertEquals(narrow.snapshot()[0]?.cols, 51);
	narrow.disposeAll();
});

test("a new prompt-column surface uses the client's own measured prompt-column width when reported", async () => {
	// Wider than the default (100) and than the whole-viewport hint's own capped fallback would
	// give — the real settled width on a docked desktop layout is exactly this kind of case
	// (r6-audit.md: "100 → 105/107 columns" at 1920px).
	const controller = new TerminalSurfaceController({
		onUpdate: () => {},
		viewportHint: () => ({ columns: 252, rows: 63, promptColumns: 107 }),
	});
	controller.mountPersistent({
		id: "widget-prompt-hint",
		kind: "widget",
		colorScheme: "dark",
		title: undefined,
		factory: () => staticComponent(["widget"]),
	});
	assertEquals(controller.snapshot()[0]?.cols, 107);
	controller.disposeAll();
});

test("a new percentage-width overlay uses the client's chrome-adjusted hint instead of the raw viewport", async () => {
	const controller = new TerminalSurfaceController({
		onUpdate: () => {},
		viewportHint: () => ({ columns: 180, rows: 50, overlayPercentColumns: 158 }),
	});
	void controller.mountCustom<string>({
		id: "overlay-percent-hint",
		overlay: true,
		colorScheme: "dark",
		overlayOptions: { width: "92%" },
		factory: () => staticComponent(["percent"]),
	});
	await flush();
	assertEquals(controller.snapshot()[0]?.cols, 158);
	controller.disposeAll();
});

test("a fixed-width overlay is also seeded from the chrome-adjusted hint", async () => {
	const controller = new TerminalSurfaceController({
		onUpdate: () => {},
		viewportHint: () => ({ columns: 180, rows: 50, overlayPercentColumns: 158 }),
	});
	void controller.mountCustom<string>({
		id: "overlay-fixed-hint",
		overlay: true,
		colorScheme: "dark",
		overlayOptions: { width: 60 },
		factory: () => staticComponent(["fixed"]),
	});
	await flush();
	// No dialog can show more cells than the viewport less its chrome, so the initial grid is
	// that (the *resolved* component width stays 60 — `TuiShim.render` clamps `options.width`
	// to the surface it's given). On a phone, the raw viewport let the panel overflow the sheet.
	assertEquals(controller.snapshot()[0]?.cols, 158);
	controller.disposeAll();
});

test("a persistent surface renders at the narrowest of every client currently reporting a size", async () => {
	const { controller } = makeController();
	controller.mountPersistent({
		id: "widget-multi-tab",
		kind: "widget",
		colorScheme: "dark",
		title: undefined,
		factory: (tui) => nudgingComponent(tui, ["widget"]),
	});
	assertEquals(
		controller.resize("widget-multi-tab", { columns: 120, rows: 30 }, "tab-a"),
		true,
	);
	controller.handleInput("widget-multi-tab", "x");
	assertEquals(controller.snapshot()[0]?.cols, 120);
	// A second, narrower tab reports its own size: the surface narrows to fit it too.
	assertEquals(
		controller.resize("widget-multi-tab", { columns: 60, rows: 20 }, "tab-b"),
		true,
	);
	controller.handleInput("widget-multi-tab", "x");
	assertEquals(controller.snapshot()[0]?.cols, 60);
	assertEquals(controller.snapshot()[0]?.rows, 20);
	// The wider tab resizing again still can't widen the surface past the narrower tab's own size.
	assertEquals(
		controller.resize("widget-multi-tab", { columns: 200, rows: 40 }, "tab-a"),
		true,
	);
	controller.handleInput("widget-multi-tab", "x");
	assertEquals(controller.snapshot()[0]?.cols, 60);
	controller.disposeAll();
});

test("forgetClient lets a persistent surface widen again once the only narrower tab disconnects", async () => {
	const { controller } = makeController();
	controller.mountPersistent({
		id: "widget-forget",
		kind: "widget",
		colorScheme: "dark",
		title: undefined,
		factory: (tui) => nudgingComponent(tui, ["widget"]),
	});
	controller.resize("widget-forget", { columns: 120, rows: 30 }, "tab-a");
	controller.resize("widget-forget", { columns: 60, rows: 20 }, "tab-b");
	controller.handleInput("widget-forget", "x");
	assertEquals(controller.snapshot()[0]?.cols, 60);

	controller.forgetClient("tab-b");
	controller.handleInput("widget-forget", "x");
	assertEquals(controller.snapshot()[0]?.cols, 120);
	assertEquals(controller.snapshot()[0]?.rows, 30);

	// Forgetting the last reporting client leaves the surface at its last known size (mirrors
	// `AppStore.clientViewportCells` falling back once every reporting client has disconnected).
	controller.forgetClient("tab-a");
	controller.handleInput("widget-forget", "x");
	assertEquals(controller.snapshot()[0]?.cols, 120);
	controller.disposeAll();
});

test("an overlay ignores per-client narrowing and keeps writing the reported size directly", async () => {
	const { controller } = makeController();
	void controller.mountCustom<string>({
		id: "overlay-direct",
		overlay: true,
		colorScheme: "dark",
		factory: (tui) => nudgingComponent(tui, ["overlay"]),
	});
	await flush();
	controller.resize("overlay-direct", { columns: 120, rows: 30 }, "tab-a");
	controller.handleInput("overlay-direct", "x");
	assertEquals(controller.snapshot()[0]?.cols, 120);
	// A second tab's smaller report replaces it outright — the client-side
	// `percentOverlayReport` convergence (not this controller) is what keeps two tabs from
	// fighting over an overlay's shared size.
	controller.resize("overlay-direct", { columns: 60, rows: 20 }, "tab-b");
	controller.handleInput("overlay-direct", "x");
	assertEquals(controller.snapshot()[0]?.cols, 60);
	controller.forgetClient("tab-a");
	controller.handleInput("overlay-direct", "x");
	// forgetClient is a no-op for an overlay: it never tracked per-client sizes to forget.
	assertEquals(controller.snapshot()[0]?.cols, 60);
	controller.disposeAll();
});
