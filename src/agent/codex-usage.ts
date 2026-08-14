import type { AgentSession } from "@earendil-works/pi-coding-agent";
import Type, { type Static } from "typebox";
import { Compile } from "typebox/compile";

import { type JsonValue, JsonObjectSchema } from "../utils/json-types.ts";
import { fetchProviderUsagePayload } from "./provider-usage.ts";
import { formatRemainingTime, remainingPercent } from "./usage-format.ts";

const codexProviderId = "openai-codex";
const codexUsageUrl = "https://chatgpt.com/backend-api/wham/usage";
const numericInputSchema = Type.Union([Type.Number(), Type.String({ pattern: "\\S" })]);
const numericInputValidator = Compile(numericInputSchema);
const jsonObjectValidator = Compile(JsonObjectSchema);
type NumericInput = Static<typeof numericInputSchema>;
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
		remainingPercent: remainingPercent(window.usedPercent),
		resetText: formatRemainingTime(
			window.resetsAt === undefined ? undefined : window.resetsAt * 1000,
		),
	};
}

export function parseCodexUsage(payload: JsonValue): CodexUsage | undefined {
	if (!jsonObjectValidator.Check(payload)) return undefined;
	const rateLimit = payload.rate_limit;
	if (!jsonObjectValidator.Check(rateLimit)) return undefined;

	const primary = parseCodexWindow(rateLimit.primary_window);
	const secondary = parseCodexWindow(rateLimit.secondary_window);
	return primary || secondary ? { primary, secondary } : undefined;
}

function parseCodexWindow(value: JsonValue | undefined): CodexWindow | undefined {
	if (!jsonObjectValidator.Check(value)) return undefined;
	const usedPercent = parseFiniteNumber(value.used_percent);
	if (usedPercent === undefined) return undefined;
	return {
		usedPercent,
		windowSeconds: parseFiniteNumber(value.limit_window_seconds),
		resetsAt: parseFiniteNumber(value.reset_at),
	};
}

function parseFiniteNumber(value: JsonValue | undefined): number | undefined {
	if (!numericInputValidator.Check(value)) return undefined;
	return finiteNumber(value);
}

function finiteNumber(value: NumericInput): number | undefined {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
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
