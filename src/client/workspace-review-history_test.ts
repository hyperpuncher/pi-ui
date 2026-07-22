/// <reference lib="dom" />

import { assertEquals } from "@std/assert";

import { formatCommitDate, formatCommitDetailDate } from "./workspace-review-history.ts";

Deno.test("commit dates use local calendar days instead of elapsed 24-hour periods", () => {
	const now = new Date(2026, 6, 22, 0, 30);

	assertEquals(
		formatCommitDate(new Date(2026, 6, 22, 0, 0).toISOString(), now),
		"today",
	);
	assertEquals(
		formatCommitDate(new Date(2026, 6, 21, 23, 30).toISOString(), now),
		"1d",
	);
	assertEquals(
		formatCommitDate(new Date(2026, 6, 20, 23, 30).toISOString(), now),
		"2d",
	);
});

Deno.test("commit detail times honor the configured time locale", () => {
	const value = new Date(2026, 6, 22, 20, 25).toISOString();
	const formatted = formatCommitDetailDate(value, "en-IE");

	assertEquals(formatted.includes("20:25"), true);
	assertEquals(/[AP]M/i.test(formatted), false);
});
