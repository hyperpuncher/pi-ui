import { formatAdaptiveDateTime, formatExpandedDateTime } from "./date-time-format.ts";

export const systemTimeLocale = posixLocaleToBcp47(
	Deno.env.get("LC_ALL") || Deno.env.get("LC_TIME") || Deno.env.get("LANG"),
);

export function formatTime(date: Date): string {
	return date.toLocaleTimeString(systemTimeLocale, {
		hour: "2-digit",
		minute: "2-digit",
		second: "2-digit",
	});
}

export function formatDateTime(
	date: Date,
	now = new Date(),
	locale = systemTimeLocale,
): string {
	return formatAdaptiveDateTime(date, now, locale);
}

export function formatFullDateTime(date: Date, locale = systemTimeLocale): string {
	return formatExpandedDateTime(date, locale);
}

export function posixLocaleToBcp47(locale: string | undefined): string | undefined {
	if (!locale) return undefined;

	const normalized = locale.split(".")[0].split("@")[0].replaceAll("_", "-");
	return normalized === "C" || normalized === "POSIX" ? undefined : normalized;
}
