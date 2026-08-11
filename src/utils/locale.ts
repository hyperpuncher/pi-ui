export const systemTimeLocale = posixLocaleToBcp47(
	Deno.env.get("LC_ALL") || Deno.env.get("LC_TIME") || Deno.env.get("LANG"),
);

const relativeDayFormat = new Intl.RelativeTimeFormat(systemTimeLocale, {
	numeric: "auto",
});

export function formatTime(date: Date): string {
	return date.toLocaleTimeString(systemTimeLocale, {
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	});
}

export function formatDateTime(date: Date, now = new Date()): string {
	const dayDifference = calendarDayDifference(date, now);
	if (dayDifference === 0) {
		return date.toLocaleTimeString(systemTimeLocale, {
			hour: "2-digit",
			minute: "2-digit",
		});
	}
	if (dayDifference === 1) {
		return relativeDayFormat.format(-1, "day");
	}
	if (dayDifference > 1 && dayDifference < 7) {
		return date.toLocaleDateString(systemTimeLocale, { weekday: "long" });
	}
	return date.toLocaleDateString(systemTimeLocale, {
		month: "short",
		day: "numeric",
		year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
	});
}

function calendarDayDifference(date: Date, now: Date): number {
	const dateDay = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
	const nowDay = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
	return Math.round((nowDay - dateDay) / 86_400_000);
}

export function posixLocaleToBcp47(locale: string | undefined): string | undefined {
	if (!locale) return undefined;

	const normalized = locale.split(".")[0].split("@")[0].replaceAll("_", "-");
	return normalized === "C" || normalized === "POSIX" ? undefined : normalized;
}
