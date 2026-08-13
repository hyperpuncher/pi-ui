export function formatAdaptiveDateTime(
	date: Date,
	now = new Date(),
	locale?: string,
): string {
	const dayDifference = calendarDayDifference(date, now);
	if (dayDifference === 0) {
		return date.toLocaleTimeString(locale, {
			hour: "2-digit",
			minute: "2-digit",
		});
	}
	if (dayDifference === 1) {
		return new Intl.RelativeTimeFormat(locale, { numeric: "auto" }).format(-1, "day");
	}
	if (dayDifference > 1 && dayDifference < 7) {
		return date.toLocaleDateString(locale, { weekday: "long" });
	}
	return date.toLocaleDateString(locale, {
		month: "short",
		day: "numeric",
		year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
	});
}

export function formatExpandedDateTime(date: Date, locale?: string): string {
	return new Intl.DateTimeFormat(locale, {
		dateStyle: "medium",
		timeStyle: "short",
	}).format(date);
}

function calendarDayDifference(date: Date, now: Date): number {
	const dateDay = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
	const nowDay = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
	return Math.round((nowDay - dateDay) / 86_400_000);
}
