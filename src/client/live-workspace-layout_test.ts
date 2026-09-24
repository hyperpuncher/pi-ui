import { test } from "bun:test";

import { assertEquals } from "#testing/assertions";

import { isDockedLayout } from "./live-workspace-layout.ts";

/**
 * Patches a global via `Object.defineProperty` (not plain assignment): another test file
 * (`file-transfer_test.ts`) leaves a `configurable: true, writable: false` global on
 * `globalThis` for the rest of the process, which a plain assignment would throw against.
 * Restores whatever was there before, the same pattern `file-transfer_test.ts`'s own
 * `restoreGlobal` uses.
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

/**
 * `isDockedLayout` reads `#workspace-shell`'s own box width and the root element's font size
 * (to convert its hard-coded `64rem` threshold to pixels) — so the fake `document` here answers
 * both `getElementById("workspace-shell")` (a fake element with a `getBoundingClientRect`) and
 * `getComputedStyle(document.documentElement)` (a fake `fontSize`).
 */
function withFakeShell<T>(
	options: { shellWidthPx: number | undefined; rootFontSizePx?: number },
	run: () => T,
): T {
	const shellEl = { getBoundingClientRect: () => ({ width: options.shellWidthPx }) };
	const documentElement = {};
	const fakeDocument = {
		documentElement,
		getElementById: (id: string) => (id === "workspace-shell" ? shellEl : null),
	};
	const restoreDocument = patchGlobal("document", fakeDocument);
	const restoreComputedStyle = patchGlobal("getComputedStyle", (el: unknown) => ({
		fontSize: el === documentElement ? `${options.rootFontSizePx ?? 16}px` : "",
	}));
	try {
		return run();
	} finally {
		restoreComputedStyle();
		restoreDocument();
	}
}

test("isDockedLayout reports docked once the shell reaches the 64rem breakpoint (O10/O11)", () => {
	withFakeShell({ shellWidthPx: 1024 }, () => assertEquals(isDockedLayout(), true));
});

test("isDockedLayout reports the overlay layout (drawer/sheet) below the breakpoint", () => {
	withFakeShell({ shellWidthPx: 1023 }, () => assertEquals(isDockedLayout(), false));
});

test("isDockedLayout converts the 64rem breakpoint against the root font size, not a hard-coded 16px", () => {
	// At a 20px root, 64rem is 1280px: 1024px (the 16px-relative threshold) must NOT be enough.
	withFakeShell({ shellWidthPx: 1024, rootFontSizePx: 20 }, () =>
		assertEquals(isDockedLayout(), false),
	);
	withFakeShell({ shellWidthPx: 1280, rootFontSizePx: 20 }, () =>
		assertEquals(isDockedLayout(), true),
	);
});

test("isDockedLayout defaults to the overlay layout when #workspace-shell isn't in the DOM yet", () => {
	const restoreDocument = patchGlobal("document", { getElementById: () => null });
	try {
		assertEquals(isDockedLayout(), false);
	} finally {
		restoreDocument();
	}
});
