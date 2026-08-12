import type { AgentSession } from "@earendil-works/pi-coding-agent";

import { asRecord } from "../utils/type-guards.ts";
import { fetchProviderUsagePayload } from "./provider-usage.ts";

const codexProviderId = "openai-codex";
const codexUsageUrl = "https://chatgpt.com/backend-api/wham/usage";
export type CodexWindow = {
	usedPercent: number;
	windowSeconds?: number;
	resetsAt?: number;
};

export type CodexUsage = {
	primary?: CodexWindow;
	secondary?: CodexWindow;
};

export type CodexUsageWindowDescription = {
	label: string;
	usedPercent: number;
	remainingPercent: number;
	resetText: string;
};

export function isOpenAICodex(model: { provider?: string } | undefined): boolean {
	return model?.provider === codexProviderId;
}

export async function fetchCodexUsage(
	session: AgentSession,
): Promise<CodexUsage | undefined> {
	const payload = await fetchProviderUsagePayload(session, codexUsageUrl);
	return payload === undefined ? undefined : parseCodexUsage(payload);
}

export function formatCodexUsage(usage: CodexUsage): string {
	return describeCodexUsage(usage)
		.map(
			(window) => `${window.label} ${window.remainingPercent}% ${window.resetText}`,
		)
		.join("  ");
}

export function describeCodexUsage(usage: CodexUsage): CodexUsageWindowDescription[] {
	const windows: CodexUsageWindowDescription[] = [];
	if (usage.primary) windows.push(describeCodexWindow(usage.primary, "5 hours"));
	if (usage.secondary) windows.push(describeCodexWindow(usage.secondary, "Weekly"));
	return windows;
}

function describeCodexWindow(
	window: CodexWindow,
	fallbackLabel: string,
): CodexUsageWindowDescription {
	return {
		label: formatWindowLabel(window.windowSeconds) ?? fallbackLabel,
		usedPercent: window.usedPercent,
		remainingPercent: Math.round(100 - clampPercent(window.usedPercent)),
		resetText: formatRemainingTime(window),
	};
}

function parseCodexUsage(payload: unknown): CodexUsage | undefined {
	const root = asRecord(payload);
	const rateLimit = asRecord(root?.rate_limit);
	if (!rateLimit) return undefined;

	const usage = {
		primary: parseCodexWindow(rateLimit.primary_window),
		secondary: parseCodexWindow(rateLimit.secondary_window),
	};

	return usage.primary || usage.secondary ? usage : undefined;
}

function parseCodexWindow(value: unknown): CodexWindow | undefined {
	const window = asRecord(value);
	if (!window) return undefined;

	const usedPercent = asNumber(window.used_percent);
	if (usedPercent === undefined) return undefined;

	return {
		usedPercent,
		windowSeconds: asNumber(window.limit_window_seconds),
		resetsAt: asNumber(window.reset_at),
	};
}

function asNumber(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim()) {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return undefined;
}

function formatWindowLabel(seconds: number | undefined): string | undefined {
	if (!seconds || seconds <= 0) return undefined;
	if (seconds === 604_800) return "Weekly";
	if (seconds >= 2_419_200 && seconds <= 2_678_400) return "Monthly";
	if (seconds === 86_400) return "Daily";
	if (seconds % 3_600 === 0) {
		const hours = seconds / 3_600;
		return `${hours} ${hours === 1 ? "hour" : "hours"}`;
	}
	if (seconds % 60 === 0) {
		const minutes = seconds / 60;
		return `${minutes} ${minutes === 1 ? "minute" : "minutes"}`;
	}
	return undefined;
}

function formatRemainingTime(window: CodexWindow): string {
	if (!window.resetsAt) return "?";

	const ms = Math.max(0, window.resetsAt * 1000 - Date.now());
	const minutes = ms / 60_000;
	if (minutes < 60) return `${Math.round(minutes)}m`;

	const hours = minutes / 60;
	if (hours < 24) return `${formatOneDecimal(hours)}h`;
	return `${formatOneDecimal(hours / 24)}d`;
}

function clampPercent(value: number): number {
	return Math.min(100, Math.max(0, value));
}

function formatOneDecimal(value: number): string {
	const rounded = Math.round(value * 10) / 10;
	return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
