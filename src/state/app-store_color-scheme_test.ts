import { test } from "bun:test";

import { assertEquals } from "#testing/assertions";

import { AppStore } from "./app-store.ts";

test("client color scheme tracks the most recent still-connected client (O4)", () => {
	const store = new AppStore();
	assertEquals(store.clientColorScheme, "dark");

	store.setClientColorScheme("light", "client-a");
	assertEquals(store.clientColorScheme, "light");
	store.setClientColorScheme("dark", "client-b");
	assertEquals(store.clientColorScheme, "dark");

	// A closed tab stops overriding the tabs that are still open.
	store.clearClientColorScheme("client-b");
	assertEquals(store.clientColorScheme, "light");

	// Clearing a client that isn't the current one leaves the current value alone.
	store.setClientColorScheme("dark", "client-c");
	store.clearClientColorScheme("client-a");
	assertEquals(store.clientColorScheme, "dark");

	store.clearClientColorScheme("client-c");
	assertEquals(store.clientColorScheme, "dark");
});

test("client color scheme reports without a client id use the legacy shared slot", () => {
	const store = new AppStore();
	store.setClientColorScheme("light");
	assertEquals(store.clientColorScheme, "light");
	store.clearClientColorScheme(AppStore.legacyClientColorSchemeKey);
	assertEquals(store.clientColorScheme, "dark");
});

test("custom renders use the narrowest transcript width any connected client reported", () => {
	const store = new AppStore();
	assertEquals(store.narrowestTranscriptColumns, undefined);

	store.setClientViewportCells(
		{ columns: 168, rows: 40, transcriptColumns: 94 },
		"wide",
	);
	store.setClientViewportCells(
		{ columns: 51, rows: 90, transcriptColumns: 38 },
		"phone",
	);
	// A client that could not measure its transcript does not count.
	store.setClientViewportCells({ columns: 20, rows: 10 }, "old");
	assertEquals(store.narrowestTranscriptColumns, 38);

	// Once the narrow tab closes, renders can use the wide tab's width again.
	store.clearClientViewportCells("phone");
	assertEquals(store.narrowestTranscriptColumns, 94);
	store.clearClientViewportCells("wide");
	assertEquals(store.narrowestTranscriptColumns, undefined);
});
