import { test } from "bun:test";

import {
	normalizeSessionSidebarPreferences,
	sessionSidebarArchiveAfterDaysMax,
	sessionSidebarWidthMax,
	sessionSidebarWidthMin,
} from "#src/session-sidebar-types.ts";
import { assertEquals } from "#testing/assertions";

test("session sidebar preferences keep only valid values", () => {
	assertEquals(normalizeSessionSidebarPreferences(undefined).open, undefined);
	assertEquals(normalizeSessionSidebarPreferences({ open: true }).open, true);
	assertEquals(normalizeSessionSidebarPreferences({ open: "yes" }).open, undefined);
});

test("session sidebar archive preferences normalize", () => {
	assertEquals(normalizeSessionSidebarPreferences({ archive: false }).archive, false);
	assertEquals(
		normalizeSessionSidebarPreferences({ archive: "no" }).archive,
		undefined,
	);
	assertEquals(
		normalizeSessionSidebarPreferences({ archiveAfterDays: 500 }).archiveAfterDays,
		sessionSidebarArchiveAfterDaysMax,
	);
	assertEquals(
		normalizeSessionSidebarPreferences({ archiveAfterDays: 5.6 }).archiveAfterDays,
		6,
	);
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
