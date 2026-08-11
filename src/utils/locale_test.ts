import { assertEquals } from "@std/assert";

import { formatDateTime, posixLocaleToBcp47, systemTimeLocale } from "./locale.ts";

Deno.test("date-time labels adapt from time to calendar context", () => {
	const now = new Date(2026, 7, 11, 16, 0);
	const today = new Date(2026, 7, 11, 15, 42);
	const yesterday = new Date(2026, 7, 10, 15, 42);
	const weekday = new Date(2026, 7, 7, 15, 42);
	const older = new Date(2026, 6, 20, 15, 42);
	const previousYear = new Date(2025, 11, 20, 15, 42);

	assertEquals(
		formatDateTime(today, now),
		today.toLocaleTimeString(systemTimeLocale, {
			hour: "2-digit",
			minute: "2-digit",
		}),
	);
	assertEquals(
		formatDateTime(yesterday, now),
		new Intl.RelativeTimeFormat(systemTimeLocale, { numeric: "auto" }).format(
			-1,
			"day",
		),
	);
	assertEquals(
		formatDateTime(weekday, now),
		weekday.toLocaleDateString(systemTimeLocale, { weekday: "long" }),
	);
	assertEquals(
		formatDateTime(older, now),
		older.toLocaleDateString(systemTimeLocale, {
			month: "short",
			day: "numeric",
		}),
	);
	assertEquals(
		formatDateTime(previousYear, now),
		previousYear.toLocaleDateString(systemTimeLocale, {
			month: "short",
			day: "numeric",
			year: "numeric",
		}),
	);
});

Deno.test("POSIX locales normalize to valid BCP 47 language tags", () => {
	assertEquals(posixLocaleToBcp47(undefined), undefined);
	assertEquals(posixLocaleToBcp47("C"), undefined);
	assertEquals(posixLocaleToBcp47("C.UTF-8"), undefined);
	assertEquals(posixLocaleToBcp47("POSIX"), undefined);
	assertEquals(posixLocaleToBcp47("en_US.UTF-8"), "en-US");
	assertEquals(posixLocaleToBcp47("de_DE@euro"), "de-DE");
});
