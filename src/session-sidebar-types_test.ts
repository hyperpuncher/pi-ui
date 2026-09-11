import { test } from "bun:test";

import { assertEquals } from "#testing/assertions";

import {
	normalizeSessionSidebarPreferences,
	sessionSidebarWidthMax,
	sessionSidebarWidthMin,
} from "./session-sidebar-types.ts";

test("session sidebar preferences keep only valid values", () => {
	assertEquals(normalizeSessionSidebarPreferences(undefined).open, undefined);
	assertEquals(normalizeSessionSidebarPreferences({ open: true }).open, true);
	assertEquals(normalizeSessionSidebarPreferences({ open: "yes" }).open, undefined);
});

test("session sidebar width clamps to the supported range", () => {
	assertEquals(
		normalizeSessionSidebarPreferences({ width: 500 }).width,
		sessionSidebarWidthMax,
	);
	assertEquals(
		normalizeSessionSidebarPreferences({ width: 100 }).width,
		sessionSidebarWidthMin,
	);
	assertEquals(normalizeSessionSidebarPreferences({ width: 300.4 }).width, 300);
	assertEquals(
		normalizeSessionSidebarPreferences({ width: Number.NaN }).width,
		undefined,
	);
});
