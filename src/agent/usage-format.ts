export function remainingPercent(usedPercent: number): number {
	const clamped = Math.min(100, Math.max(0, usedPercent));
	return Math.round(100 - clamped);
}

export function formatRemainingTime(resetsAtMs: number | undefined): string {
	if (!resetsAtMs) return "?";
	const minutes = Math.max(0, resetsAtMs - Date.now()) / 60_000;
	if (minutes < 60) return `${Math.round(minutes)}m`;
	const hours = minutes / 60;
	if (hours < 24) return `${formatOneDecimal(hours)}h`;
	return `${formatOneDecimal(hours / 24)}d`;
}

function formatOneDecimal(value: number): string {
	const rounded = Math.round(value * 10) / 10;
	return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
