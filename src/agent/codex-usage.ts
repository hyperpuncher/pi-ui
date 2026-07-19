import type { AgentSession } from "@earendil-works/pi-coding-agent";

import { asRecord } from "../utils/type-guards.ts";

const codexProviderId = "openai-codex";
const codexUsageUrl = "https://chatgpt.com/backend-api/wham/usage";
const codexUsageTimeoutMs = 15_000;

export const codexUsageTtlMs = 60 * 1000;

export type CodexWindow = {
	usedPercent: number;
	windowSeconds?: number;
	resetsAt?: number;
};

export type CodexUsage = {
	primary?: CodexWindow;
	secondary?: CodexWindow;
};

export function isOpenAICodex(model: { provider?: string } | undefined): boolean {
	return model?.provider === codexProviderId;
}

export async function fetchCodexUsage(
	session: AgentSession,
): Promise<CodexUsage | undefined> {
	const model = session.model;
	if (!model) return undefined;

	const resolution = await session.modelRuntime.getAuth(model);
	if (!resolution) return undefined;

	const headers = new Headers();
	for (const [name, value] of Object.entries(resolution.auth.headers ?? {})) {
		if (value !== null) headers.set(name, value);
	}
	if (!headers.has("authorization")) {
		if (!resolution.auth.apiKey) return undefined;
		headers.set("Authorization", `Bearer ${resolution.auth.apiKey}`);
	}
	if (!headers.has("user-agent")) {
		headers.set("User-Agent", "pi-ui");
	}

	const controller = new AbortController();
	const timeout = setTimeout(() => controller.abort(), codexUsageTimeoutMs);
	try {
		const response = await fetch(codexUsageUrl, {
			headers,
			signal: controller.signal,
		});
		if (!response.ok) return undefined;
		return parseCodexUsage(await response.json());
	} finally {
		clearTimeout(timeout);
	}
}

export function formatCodexUsage(usage: CodexUsage): string {
	const parts: string[] = [];
	if (usage.primary) {
		parts.push(formatCodexWindow(usage.primary, "5h"));
	}
	if (usage.secondary) {
		parts.push(formatCodexWindow(usage.secondary, "1w"));
	}
	return parts.join("  ");
}

function formatCodexWindow(window: CodexWindow, fallbackLabel: string): string {
	return `${formatWindowDuration(window.windowSeconds) ?? fallbackLabel} ${formatRemainingPercent(window)} ${formatRemainingTime(window)}`;
}

function formatWindowDuration(seconds: number | undefined): string | undefined {
	if (!seconds || seconds <= 0) return undefined;
	if (seconds < 3_600) return `${formatOneDecimal(seconds / 60)}m`;
	if (seconds < 86_400) return `${formatOneDecimal(seconds / 3_600)}h`;
	if (seconds < 604_800) return `${formatOneDecimal(seconds / 86_400)}d`;
	return `${formatOneDecimal(seconds / 604_800)}w`;
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

function formatRemainingPercent(window: CodexWindow): string {
	return `${Math.round(100 - clampPercent(window.usedPercent))}%`;
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
