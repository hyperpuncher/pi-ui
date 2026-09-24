import { test } from "bun:test";

import { assertEquals, assertNotEquals } from "#testing/assertions";

import { isPiUiSheetElement, piUiDialogId, piUiSlug } from "./extension-surface-types.ts";

test("piUiSlug passes already-clean slugs through unchanged", () => {
	assertEquals(piUiSlug("ask-user"), "ask-user");
	assertEquals(piUiSlug("panel_1"), "panel_1");
});

test("piUiSlug disambiguates two different values that substitute to the same slug", () => {
	const a = piUiSlug("a.b");
	const b = piUiSlug("a_b");
	const c = piUiSlug("a/b");
	// "a_b" was already clean, so it passes through unchanged...
	assertEquals(b, "a_b");
	// ...while "a.b" and "a/b" both need substitution and must not collide with
	// it or with each other.
	assertNotEquals(a, b);
	assertNotEquals(c, b);
	assertNotEquals(a, c);
});

test("piUiSlug is deterministic for the same input", () => {
	assertEquals(piUiSlug("a.b:c"), piUiSlug("a.b:c"));
});

test("piUiDialogId stays distinct for ns/id pairs that only differ by punctuation", () => {
	const first = piUiDialogId({ ns: "a.b", id: "x" });
	const second = piUiDialogId({ ns: "a_b", id: "x" });
	assertNotEquals(first, second);
});

test("isPiUiSheetElement matches only sheet and screen placements", () => {
	assertEquals(isPiUiSheetElement({ placement: "sheet" }), true);
	assertEquals(isPiUiSheetElement({ placement: "screen" }), true);
	assertEquals(isPiUiSheetElement({ placement: "inline" }), false);
	assertEquals(isPiUiSheetElement({ placement: "pinned" }), false);
	assertEquals(isPiUiSheetElement({ placement: "status" }), false);
});
