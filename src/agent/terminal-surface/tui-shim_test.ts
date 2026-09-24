import { test } from "bun:test";

import type { Component } from "@earendil-works/pi-tui";

import { assertEquals, assertFalse } from "#testing/assertions";

import { HeadlessTerminal } from "./headless-terminal.ts";
import { TuiShim } from "./tui-shim.ts";

type FixtureComponent = Component & { focused?: boolean; label: string };

function fixture(label: string, lines: string[] = [label]): FixtureComponent {
	return {
		label,
		focused: false,
		render: () => lines,
		invalidate: () => {},
	};
}

function makeShim() {
	const renders: boolean[] = [];
	const shim = new TuiShim(new HeadlessTerminal(), {
		requestRender: (force) => renders.push(force),
	});
	return { shim, renders };
}

test("tui shim renders stacked root children when there is no overlay", () => {
	const { shim } = makeShim();
	shim.addChild(fixture("a"));
	shim.addChild(fixture("b"));
	assertEquals(shim.render(80), ["a", "b"]);
	assertFalse(shim.hasOverlay());
});

test("tui shim removeChild and clear drop mounted children", () => {
	const { shim } = makeShim();
	const a = fixture("a");
	const b = fixture("b");
	shim.addChild(a);
	shim.addChild(b);
	shim.removeChild(a);
	assertEquals(shim.render(80), ["b"]);
	shim.clear();
	assertEquals(shim.render(80), []);
});

test("tui shim setFocus toggles Focusable.focused and getFocusedComponent tracks it", () => {
	const { shim } = makeShim();
	const a = fixture("a");
	const b = fixture("b");
	shim.setFocus(a);
	assertEquals(a.focused, true);
	assertEquals(shim.getFocusedComponent(), a);
	shim.setFocus(b);
	assertEquals(a.focused, false);
	assertEquals(b.focused, true);
	shim.setFocus(null);
	assertEquals(b.focused, false);
	assertEquals(shim.getFocusedComponent(), null);
});

test("tui shim showOverlay renders the overlay instead of root children and requests a render", () => {
	const { shim, renders } = makeShim();
	shim.addChild(fixture("root"));
	const overlay = fixture("overlay");
	const handle = shim.showOverlay(overlay);
	assertEquals(shim.hasOverlay(), true);
	assertEquals(shim.render(80), ["overlay"]);
	// showOverlay focuses the overlay by default (no `nonCapturing`).
	assertEquals(shim.getFocusedComponent(), overlay);
	assertEquals(renders, [false]);
	handle.hide();
	assertEquals(shim.hasOverlay(), false);
	assertEquals(shim.render(80), ["root"]);
});

test("tui shim stacks overlays and renders only the topmost visible one", () => {
	const { shim } = makeShim();
	const first = fixture("first");
	const second = fixture("second");
	shim.showOverlay(first);
	const secondHandle = shim.showOverlay(second);
	assertEquals(shim.render(80), ["second"]);
	secondHandle.setHidden(true);
	assertEquals(shim.render(80), ["first"]);
	// Hiding the focused overlay hands focus back to the next visible one.
	assertEquals(shim.getFocusedComponent(), first);
	secondHandle.setHidden(false);
	assertEquals(shim.render(80), ["second"]);
});

test("tui shim overlay handle hide/setHidden/isHidden/focus/unfocus round-trip", () => {
	const { shim } = makeShim();
	const overlay = fixture("overlay");
	const handle = shim.showOverlay(overlay);
	assertEquals(handle.isHidden(), false);
	assertEquals(handle.isFocused(), true);
	handle.unfocus();
	assertEquals(handle.isFocused(), false);
	assertEquals(shim.getFocusedComponent(), null);
	handle.focus();
	assertEquals(handle.isFocused(), true);
	handle.setHidden(true);
	assertEquals(handle.isHidden(), true);
	assertEquals(shim.hasOverlay(), false);
	handle.hide();
	assertEquals(shim.render(80), []);
});

test("tui shim resolves a percentage overlay width against the render width", () => {
	const { shim } = makeShim();
	const overlay = fixture("overlay", ["a very long line that would be clipped"]);
	shim.showOverlay(overlay, { width: "50%" });
	shim.render(100);
	assertEquals(shim.lastOverlayWidth, 50);
});

test("tui shim handleInput routes to input listeners before the focused component", () => {
	const { shim } = makeShim();
	const seen: string[] = [];
	const target = fixture("target");
	target.handleInput = (data: string) => seen.push(data);
	shim.addChild(target);
	shim.setFocus(target);

	const unsubscribe = shim.addInputListener((data) => {
		if (data === "\u001b[A") return { consume: true };
		if (data === "\u001b[B") return { data: "rewritten" };
		return undefined;
	});

	shim.handleInput("\u001b[A");
	assertEquals(seen, []);
	shim.handleInput("\u001b[B");
	assertEquals(seen, ["rewritten"]);
	shim.handleInput("x");
	assertEquals(seen, ["rewritten", "x"]);

	unsubscribe();
	shim.handleInput("\u001b[A");
	// The listener was removed, so the up arrow now reaches the component untouched.
	assertEquals(seen, ["rewritten", "x", "\u001b[A"]);
});

test("tui shim handleInput falls back to the topmost overlay, then the last root child", () => {
	const { shim } = makeShim();
	const root = fixture("root");
	const rootSeen: string[] = [];
	root.handleInput = (data) => rootSeen.push(data);
	shim.addChild(root);

	shim.handleInput("a");
	assertEquals(rootSeen, ["a"]);

	const overlay = fixture("overlay");
	const overlaySeen: string[] = [];
	overlay.handleInput = (data) => overlaySeen.push(data);
	shim.showOverlay(overlay);
	shim.handleInput("b");
	// Overlay is now focused, so input goes there, not the root child.
	assertEquals(overlaySeen, ["b"]);
	assertEquals(rootSeen, ["a"]);
});

test("tui shim requestRender/renderNow forward force through to the callback", () => {
	const { shim, renders } = makeShim();
	shim.requestRender();
	shim.renderNow();
	assertEquals(renders, [false, true]);
});

test("tui shim renders after dispatching input, like pi-tui's TUI", () => {
	const { shim, renders } = makeShim();
	const target = fixture("target");
	target.handleInput = () => {};
	shim.addChild(target);
	shim.setFocus(target);
	const before = renders.length;
	shim.handleInput("\u001b[B");
	assertEquals(renders.slice(before), [true]);
});

test("tui shim defaults an overlay without a width to min(80, available) after margins", () => {
	const { shim } = makeShim();
	shim.showOverlay(fixture("wide"));
	shim.render(159);
	assertEquals(shim.lastOverlayWidth, 80);
	shim.render(60);
	assertEquals(shim.lastOverlayWidth, 60);
	shim.hideOverlay();
	shim.showOverlay(fixture("margined"), { width: 200, margin: 2 });
	shim.render(100);
	assertEquals(shim.lastOverlayWidth, 96);
});

test("tui shim splits batched input into single key sequences and re-renders after each", () => {
	const { shim, renders } = makeShim();
	const received: string[] = [];
	const target: FixtureComponent = {
		...fixture("input"),
		handleInput: (data) => received.push(data),
	};
	shim.addChild(target);
	shim.setFocus(target);
	renders.length = 0;
	shim.handleInput("\u001b[B\u001b[Bx\r");
	assertEquals(received, ["\u001b[B", "\u001b[B", "x", "\r"]);
	assertEquals(renders.length, 4);
});

test("tui shim delivers a lone Esc immediately and keeps bracketed paste whole", () => {
	const { shim } = makeShim();
	const received: string[] = [];
	const target: FixtureComponent = {
		...fixture("input"),
		handleInput: (data) => received.push(data),
	};
	shim.addChild(target);
	shim.setFocus(target);
	shim.handleInput("\u001b");
	shim.handleInput("\u001b[200~a\nb\u001b[201~");
	assertEquals(received, ["\u001b", "\u001b[200~a\nb\u001b[201~"]);
});
