// Intl formatters are slow to build, so each locale and format is built once.
const formatters = new Map<string, Intl.DateTimeFormat | Intl.RelativeTimeFormat>();

function dateFormatter(
	locale: string | undefined,
	options: Intl.DateTimeFormatOptions,
): Intl.DateTimeFormat {
	const key = `d${locale ?? ""}${JSON.stringify(options)}`;
	let formatter = formatters.get(key);
	if (!(formatter instanceof Intl.DateTimeFormat)) {
		formatter = new Intl.DateTimeFormat(locale, options);
		formatters.set(key, formatter);
	}
	return formatter;
}

function relativeFormatter(locale: string | undefined): Intl.RelativeTimeFormat {
	const key = `r${locale ?? ""}`;
	let formatter = formatters.get(key);
	if (!(formatter instanceof Intl.RelativeTimeFormat)) {
		formatter = new Intl.RelativeTimeFormat(locale, { numeric: "auto" });
		formatters.set(key, formatter);
	}
	return formatter;
}

export function formatAdaptiveDateTime(
	date: Date,
	now = new Date(),
	locale?: string,
): string {
	const dayDifference = calendarDayDifference(date, now);
	if (dayDifference === 0) {
		return dateFormatter(locale, { hour: "2-digit", minute: "2-digit" }).format(date);
	}
	if (dayDifference === 1) return relativeFormatter(locale).format(-1, "day");
	return formatCalendarDay(date, now, locale);
}

/** Weekday for the current week, otherwise a compact month and day. */
export function formatCalendarDay(date: Date, now = new Date(), locale?: string): string {
	const dayDifference = calendarDayDifference(date, now);
	if (dayDifference > 1 && dayDifference < 7) {
		return dateFormatter(locale, { weekday: "long" }).format(date);
	}
	return dateFormatter(
		locale,
		date.getFullYear() === now.getFullYear()
			? { month: "short", day: "numeric" }
			: { month: "short", day: "numeric", year: "numeric" },
	).format(date);
}

export function formatExpandedDateTime(date: Date, locale?: string): string {
	return dateFormatter(locale, { dateStyle: "medium", timeStyle: "short" }).format(
		date,
	);
}

export function calendarDayDifference(date: Date, now: Date): number {
	const dateDay = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
	const nowDay = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
	return Math.round((nowDay - dateDay) / 86_400_000);
}
