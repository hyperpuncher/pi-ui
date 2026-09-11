import { isBoolean, isNumber, isRecord, type JsonRecord } from "./utils/type-guards.ts";

export const sessionSidebarWidthMin = 224;
export const sessionSidebarWidthMax = 384;
export const sessionSidebarWidthDefault = 288;

export type SessionSidebarPreferences = Readonly<{
	open?: boolean;
	width?: number;
}>;

/** Keeps only valid, clamped preference values so partial updates can merge. */
export function normalizeSessionSidebarPreferences<Value>(
	value: Value,
): SessionSidebarPreferences {
	if (!isRecord(value)) return {};
	return {
		open: isBoolean(value.open) ? value.open : undefined,
		width: normalizedWidth(value.width),
	};
}

function normalizedWidth(value: JsonRecord[string]): number | undefined {
	return isNumber(value)
		? Math.min(
				Math.max(Math.round(value), sessionSidebarWidthMin),
				sessionSidebarWidthMax,
			)
		: undefined;
}
