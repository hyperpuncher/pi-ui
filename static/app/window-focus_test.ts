import { assertEquals } from "@std/assert";

import { createWindowFocusGuard } from "./window-focus.js";

type Focusable = {
	isConnected: boolean;
	blur(): void;
	focus(options?: { preventScroll?: boolean }): void;
};

Deno.test("window focus guard blurs and restores the focused control", () => {
	const body = focusable();
	const input = focusable();
	let active: Focusable = input;
	let frame: (() => void) | undefined;
	input.blur = () => {
		active = body;
	};
	input.focus = (options) => {
		assertEquals(options, { preventScroll: true });
		active = input;
	};
	const guard = createWindowFocusGuard({
		activeElement: () => active,
		body: () => body,
		requestFrame: (callback: () => void) => {
			frame = callback;
			return 1;
		},
	});

	guard.suspend();
	assertEquals(active, body);
	guard.restore();
	frame?.();
	assertEquals(active, input);
});

Deno.test("window focus guard does not steal focus or run a stale restore", () => {
	const body = focusable();
	const input = focusable();
	const other = focusable();
	let active: Focusable = input;
	let frame: (() => void) | undefined;
	let focusCount = 0;
	input.blur = () => {
		active = body;
	};
	input.focus = () => {
		focusCount += 1;
	};
	const guard = createWindowFocusGuard({
		activeElement: () => active,
		body: () => body,
		requestFrame: (callback: () => void) => {
			frame = callback;
			return 1;
		},
	});

	guard.suspend();
	guard.restore();
	active = other;
	frame?.();
	assertEquals(focusCount, 0);

	active = input;
	guard.suspend();
	guard.restore();
	guard.suspend();
	frame?.();
	assertEquals(focusCount, 0);
});

function focusable(): Focusable {
	return {
		isConnected: true,
		blur() {},
		focus() {},
	};
}
