import { formatAdaptiveDateTime, formatExpandedDateTime } from "./date-time-format.ts";

export const systemTimeLocale = posixLocaleToBcp47(
	process.env.LC_ALL || process.env.LC_TIME || process.env.LANG,
);

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
