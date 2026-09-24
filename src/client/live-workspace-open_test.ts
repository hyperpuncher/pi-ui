import { test } from "bun:test";

import { assertEquals } from "#testing/assertions";

import { bindDismissibleHistory } from "../../static/app/history-stack.js";
import { bindLiveWorkspace } from "./live-workspace-open.ts";

/** Patches a global via `Object.defineProperty` (see live-workspace-layout_test.ts). */
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

type Layout = { shellWidthPx: number; panePosition: "relative" | "fixed" | "absolute" };

/**
 * Fakes just the DOM `bindLiveWorkspace()` and `bindDismissibleHistory()` touch: `#app` (its
 * `live-workspace-open` class and the SSR'd initial-open signal attribute), the pane (its
 * computed `position`, which is how the CSS says docked vs overlay), `#workspace-shell`'s
 * width (what `isDockedLayout()` measures), and a history guard that records push/pop.
 */
function installFakeLiveWorkspace(
	options: Layout & { initiallyOpen: boolean; classAppliedAtBind?: boolean },
) {
	const layout: Layout = { ...options };
	const classApplied = options.classAppliedAtBind ?? options.initiallyOpen;
	const classes = new Set<string>(classApplied ? ["live-workspace-open"] : []);
	const appEvents: Array<{ type: string; open: unknown }> = [];
	const bodyEvents: Array<{ type: string; open: unknown }> = [];
	let classObserver: (() => void) | undefined;
	const record = (log: typeof appEvents) => (event: Event) => {
		log.push({ type: event.type, open: (event as CustomEvent).detail?.open });
		return true;
	};
	const app = {
		classList: { contains: (name: string) => classes.has(name) },
		getAttribute: (name: string) =>
			name === "data-signals:_live-workspace-open__ifmissing"
				? String(options.initiallyOpen)
				: null,
		dispatchEvent: record(appEvents),
	};
	const pane = { querySelector: () => ({ focus() {} }), contains: () => false };
	const shell = { getBoundingClientRect: () => ({ width: layout.shellWidthPx }) };
	const documentElement = {};
	const body = { dispatchEvent: record(bodyEvents) };
	const elements = new Map<string, typeof app | typeof pane | typeof shell>([
		["app", app],
		["live-workspace", pane],
		["workspace-shell", shell],
	]);
	const fakeDocument = {
		body,
		documentElement,
		activeElement: null,
		addEventListener() {},
		getElementById: (id: string) => elements.get(id) ?? null,
	};
	const history = { pushes: 0, pops: 0 };
	let popstate: (() => void) | undefined;
	const restores = [
		patchGlobal("document", fakeDocument),
		patchGlobal("window", {
			addEventListener: (_type: string, listener: () => void) =>
				(popstate = listener),
		}),
		patchGlobal("getComputedStyle", (element: unknown) =>
			element === documentElement
				? { fontSize: "16px" }
				: { position: element === pane ? layout.panePosition : "static" },
		),
		patchGlobal("requestAnimationFrame", (callback: (time: number) => void) => {
			callback(0);
			return 0;
		}),
		patchGlobal(
			"MutationObserver",
			class {
				#callback: () => void;
				constructor(callback: () => void) {
					this.#callback = callback;
				}
				observe(target: unknown) {
					if (target === app) classObserver = this.#callback;
				}
				disconnect() {
					if (classObserver === this.#callback) classObserver = undefined;
				}
			},
		),
	];
	bindDismissibleHistory(
		{
			notifyOpen: () => (history.pushes += 1),
			notifyClose: () => (history.pops += 1),
			handlePopstate: (hasOpen: () => boolean, close: () => void) => {
				if (hasOpen()) close();
			},
		},
		// The patched globals: typed as the real `Document`/`Window` the defaults expect.
		document,
		window,
	);
	const binding = bindLiveWorkspace();
	return {
		binding,
		history,
		appEvents,
		bodyEvents,
		setOpenClass(open: boolean) {
			if (open) classes.add("live-workspace-open");
			else classes.delete("live-workspace-open");
			classObserver?.();
		},
		pressBack: () => popstate?.(),
		restore() {
			binding.dispose();
			for (const restore of restores.reverse()) restore();
		},
	};
}

test("a pane restored open in the docked layout stays open and is not a Back target", () => {
	const dom = installFakeLiveWorkspace({
		initiallyOpen: true,
		shellWidthPx: 1600,
		panePosition: "relative",
	});
	try {
		assertEquals(dom.appEvents, []);
		assertEquals(dom.history.pushes, 0);
		dom.pressBack();
		// Docked, the pane is part of the layout: Back leaves it alone.
		assertEquals(dom.appEvents, []);
		assertEquals(dom.bodyEvents, []);
	} finally {
		dom.restore();
	}
});

test("a pane restored open at an overlay width closes without persisting (O10)", () => {
	const dom = installFakeLiveWorkspace({
		initiallyOpen: true,
		shellWidthPx: 700,
		panePosition: "fixed",
	});
	try {
		assertEquals(dom.appEvents, [{ type: "pi-ui-live-workspace-open", open: false }]);
		// No preferences event: the docked-layout preference survives for wider windows.
		assertEquals(dom.bodyEvents, []);
		assertEquals(dom.history.pushes, 0);
	} finally {
		dom.restore();
	}
});

test("a restored open state adopted after Datastar applies the class late", () => {
	const dom = installFakeLiveWorkspace({
		initiallyOpen: true,
		classAppliedAtBind: false,
		shellWidthPx: 1600,
		panePosition: "relative",
	});
	try {
		// SSR said "open" but the class wasn't applied yet at bind time.
		assertEquals(dom.appEvents, []);
		dom.setOpenClass(true);
		// Adopted as open, docked: no close, no history entry, and the data-effect's own
		// `applyOpen(true)` afterwards is a no-op.
		dom.binding.applyOpen(true);
		assertEquals(dom.appEvents, []);
		assertEquals(dom.history.pushes, 0);
		dom.binding.applyOpen(false);
		assertEquals(dom.history.pops, 0);
	} finally {
		dom.restore();
	}
});

test("a late-applied restored open state at an overlay width is closed (O10)", () => {
	const dom = installFakeLiveWorkspace({
		initiallyOpen: true,
		classAppliedAtBind: false,
		shellWidthPx: 700,
		panePosition: "fixed",
	});
	try {
		assertEquals(dom.appEvents, []);
		dom.setOpenClass(true);
		assertEquals(dom.appEvents, [{ type: "pi-ui-live-workspace-open", open: false }]);
		assertEquals(dom.bodyEvents, []);
		assertEquals(dom.history.pushes, 0);
	} finally {
		dom.restore();
	}
});

test("Back closes a pane opened as an overlay, without a second history pop", () => {
	const dom = installFakeLiveWorkspace({
		initiallyOpen: false,
		shellWidthPx: 700,
		panePosition: "fixed",
	});
	try {
		dom.setOpenClass(true);
		dom.binding.applyOpen(true);
		assertEquals(dom.history.pushes, 1);

		dom.pressBack();
		assertEquals(dom.appEvents, [{ type: "pi-ui-live-workspace-open", open: false }]);
		assertEquals(dom.bodyEvents, [
			{ type: "pi-ui-live-workspace-preferences", open: false },
		]);
		// The back press consumed the entry; the resulting close must not pop again.
		dom.setOpenClass(false);
		dom.binding.applyOpen(false);
		assertEquals(dom.history.pops, 0);
	} finally {
		dom.restore();
	}
});

test("closing an overlay pane normally pops its history entry once", () => {
	const dom = installFakeLiveWorkspace({
		initiallyOpen: false,
		shellWidthPx: 700,
		panePosition: "absolute",
	});
	try {
		dom.setOpenClass(true);
		dom.binding.applyOpen(true);
		dom.setOpenClass(false);
		dom.binding.applyOpen(false);
		assertEquals(dom.history, { pushes: 1, pops: 1 });
	} finally {
		dom.restore();
	}
});
