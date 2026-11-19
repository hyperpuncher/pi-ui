import type { AppUsageLimitWindow } from "#src/state/app-store.ts";
import { clamp } from "#src/utils/clamp.ts";

function remainingPercent(usedPercent: number): number {
	return Math.round(100 - clamp(usedPercent, 0, 100));
}

function formatRemainingTime(resetsAtMs: number | undefined): string {
	if (!resetsAtMs) return "?";
	const minutes = Math.max(0, resetsAtMs - Date.now()) / 60_000;
	if (minutes < 60) return `${Math.round(minutes)}m`;
	const hours = minutes / 60;
	if (hours < 24) return `${formatOneDecimal(hours)}h`;
	return `${formatOneDecimal(hours / 24)}d`;
}

export function describeLimitWindow(
	label: string,
	usedPercent: number,
	resetsAtMs: number | undefined,
): AppUsageLimitWindow {
	return {
		label,
		usedPercent,
		remainingPercent: remainingPercent(usedPercent),
		resetText: formatRemainingTime(resetsAtMs),
	};
}

function formatOneDecimal(value: number): string {
	const rounded = Math.round(value * 10) / 10;
	return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
