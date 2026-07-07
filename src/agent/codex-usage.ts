import type { AgentSession } from "@earendil-works/pi-coding-agent";

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

	const auth = await session.modelRegistry.getApiKeyAndHeaders(model);
	if (!auth.ok) throw new Error(auth.error);

	const headers = { ...auth.headers };
	if (!hasHeader(headers, "authorization")) {
		if (!auth.apiKey) return undefined;
		headers.Authorization = `Bearer ${auth.apiKey}`;
	}
	if (!hasHeader(headers, "user-agent")) {
		headers["User-Agent"] = "pi-ui";
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
		parts.push(
			`5h ${formatRemainingPercent(usage.primary)} ${formatRemainingTime(usage.primary)}`,
		);
	}
	if (usage.secondary) {
		parts.push(
			`1w ${formatRemainingPercent(usage.secondary)} ${formatRemainingTime(usage.secondary)}`,
		);
	}
	return parts.join("  ");
}

function hasHeader(headers: Record<string, string>, name: string): boolean {
	return Object.keys(headers).some((key) => key.toLowerCase() === name);
}

function parseCodexUsage(payload: unknown): CodexUsage | undefined {
	const root = asObject(payload);
	const rateLimit = asObject(root?.rate_limit);
	if (!rateLimit) return undefined;

	const usage = {
		primary: parseCodexWindow(rateLimit.primary_window),
		secondary: parseCodexWindow(rateLimit.secondary_window),
	};

	return usage.primary || usage.secondary ? usage : undefined;
}

function parseCodexWindow(value: unknown): CodexWindow | undefined {
	const window = asObject(value);
	if (!window) return undefined;

	const usedPercent = asNumber(window.used_percent);
	if (usedPercent === undefined) return undefined;

	return {
		usedPercent,
		windowSeconds: asNumber(window.limit_window_seconds),
		resetsAt: asNumber(window.reset_at),
	};
}

function asObject(value: unknown): Record<string, unknown> | undefined {
	return value && typeof value === "object" && !Array.isArray(value)
		? (value as Record<string, unknown>)
		: undefined;
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
