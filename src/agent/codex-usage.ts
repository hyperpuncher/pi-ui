import type { AgentSession } from "@earendil-works/pi-coding-agent";
import Type, { type Static } from "typebox";
import { Compile } from "typebox/compile";

import type { JsonValue } from "../utils/json-types.ts";
import { fetchProviderUsagePayload } from "./provider-usage.ts";
import { formatRemainingTime, remainingPercent } from "./usage-format.ts";

const codexProviderId = "openai-codex";
const codexUsageUrl = "https://chatgpt.com/backend-api/wham/usage";
const numericInputSchema = Type.Union([Type.Number(), Type.String({ pattern: "\\S" })]);
const codexWindowSchema = Type.Object({
	used_percent: numericInputSchema,
	limit_window_seconds: Type.Optional(numericInputSchema),
	reset_at: Type.Optional(numericInputSchema),
});
const codexPayloadSchema = Type.Object({
	rate_limit: Type.Object({
		primary_window: Type.Optional(codexWindowSchema),
		secondary_window: Type.Optional(codexWindowSchema),
	}),
});
const codexPayloadValidator = Compile(codexPayloadSchema);
type NumericInput = Static<typeof numericInputSchema>;
type CodexWindowInput = Static<typeof codexWindowSchema>;
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

function parseCodexUsage(payload: JsonValue): CodexUsage | undefined {
	if (!codexPayloadValidator.Check(payload)) return undefined;
	const primary = parseCodexWindow(payload.rate_limit.primary_window);
	const secondary = parseCodexWindow(payload.rate_limit.secondary_window);
	return primary || secondary ? { primary, secondary } : undefined;
}

function parseCodexWindow(window: CodexWindowInput | undefined): CodexWindow | undefined {
	if (!window) return undefined;
	const usedPercent = finiteNumber(window.used_percent);
	if (usedPercent === undefined) return undefined;
	return {
		usedPercent,
		windowSeconds: optionalFiniteNumber(window.limit_window_seconds),
		resetsAt: optionalFiniteNumber(window.reset_at),
	};
}

function finiteNumber(value: NumericInput): number | undefined {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function optionalFiniteNumber(value: NumericInput | undefined): number | undefined {
	return value === undefined ? undefined : finiteNumber(value);
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
