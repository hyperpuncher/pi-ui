import { isBoolean, isNumber, isRecord, type JsonRecord } from "./utils/type-guards.ts";

export const sessionSidebarWidthMin = 224;
export const sessionSidebarWidthMax = 384;
export const sessionSidebarWidthDefault = 288;
export const sessionSidebarArchiveAfterDaysMin = 1;
export const sessionSidebarArchiveAfterDaysMax = 365;
export const sessionSidebarArchiveAfterDaysDefault = 2;

export type SessionSidebarPreferences = Readonly<{
	open?: boolean;
	width?: number;
	archive?: boolean;
	archiveAfterDays?: number;
}>;

/** Keeps only valid, clamped preference values so partial updates can merge. */
export function normalizeSessionSidebarPreferences<Value>(
	value: Value,
): SessionSidebarPreferences {
	if (!isRecord(value)) return {};
	return {
		open: isBoolean(value.open) ? value.open : undefined,
		width: clampedNumber(value.width, sessionSidebarWidthMin, sessionSidebarWidthMax),
		archive: isBoolean(value.archive) ? value.archive : undefined,
		archiveAfterDays: clampedNumber(
			value.archiveAfterDays,
			sessionSidebarArchiveAfterDaysMin,
			sessionSidebarArchiveAfterDaysMax,
		),
	};
}

function clampedNumber(
	value: JsonRecord[string],
	min: number,
	max: number,
): number | undefined {
	return isNumber(value) ? Math.min(Math.max(Math.round(value), min), max) : undefined;
}
