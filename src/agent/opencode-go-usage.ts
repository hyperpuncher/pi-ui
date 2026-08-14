import type { AgentSession } from "@earendil-works/pi-coding-agent";
import Type, { type Static } from "typebox";
import { Compile } from "typebox/compile";

import type { JsonValue } from "../utils/json-types.ts";
import { fetchProviderUsagePayload } from "./provider-usage.ts";
import { formatRemainingTime, remainingPercent } from "./usage-format.ts";

const opencodeGoProviderId = "opencode-go";
const opencodeGoUsageUrl = "https://opencode.ai/zen/go/v1/usage";
const stringInputSchema = Type.String({ pattern: "\\S" });
const numericInputSchema = Type.Union([Type.Number(), stringInputSchema]);
const timestampInputSchema = Type.Union([Type.Number(), stringInputSchema]);
const usageWindowSchema = Type.Object({
	percent: numericInputSchema,
	resetsAt: Type.Optional(timestampInputSchema),
});
const openCodeGoPayloadSchema = Type.Object({
	usage: Type.Object({
		rolling: Type.Optional(usageWindowSchema),
		weekly: Type.Optional(usageWindowSchema),
		monthly: Type.Optional(usageWindowSchema),
	}),
});
const openCodeGoPayloadValidator = Compile(openCodeGoPayloadSchema);
const stringInputValidator = Compile(stringInputSchema);
type NumericInput = Static<typeof numericInputSchema>;
type TimestampInput = Static<typeof timestampInputSchema>;
type UsageWindowInput = Static<typeof usageWindowSchema>;
export type OpenCodeGoWindow = {
	usedPercent: number;
	resetsAt?: number;
};

export type OpenCodeGoUsage = {
	rolling?: OpenCodeGoWindow;
	weekly?: OpenCodeGoWindow;
	monthly?: OpenCodeGoWindow;
};

export type OpenCodeGoUsageWindowDescription = {
	label: string;
	usedPercent: number;
	remainingPercent: number;
	resetText: string;
};

export function isOpenCodeGo(model: { provider?: string } | undefined): boolean {
	return model?.provider === opencodeGoProviderId;
}

export async function fetchOpenCodeGoUsage(
	session: AgentSession,
): Promise<OpenCodeGoUsage | undefined> {
	const payload = await fetchProviderUsagePayload(session, opencodeGoUsageUrl);
	return payload === undefined ? undefined : parseOpenCodeGoUsage(payload);
}

export function parseOpenCodeGoUsage(payload: JsonValue): OpenCodeGoUsage | undefined {
	if (!openCodeGoPayloadValidator.Check(payload)) return undefined;
	const parsed = {
		rolling: parseWindow(payload.usage.rolling),
		weekly: parseWindow(payload.usage.weekly),
		monthly: parseWindow(payload.usage.monthly),
	};
	return parsed.rolling || parsed.weekly || parsed.monthly ? parsed : undefined;
}

export function formatOpenCodeGoUsage(usage: OpenCodeGoUsage): string {
	return describeOpenCodeGoUsage(usage)
		.map(
			(window) => `${window.label} ${window.remainingPercent}% ${window.resetText}`,
		)
		.join("  ");
}

export function describeOpenCodeGoUsage(
	usage: OpenCodeGoUsage,
): OpenCodeGoUsageWindowDescription[] {
	const windows: OpenCodeGoUsageWindowDescription[] = [];
	if (usage.rolling) windows.push(describeWindow(usage.rolling, "5 hours"));
	if (usage.weekly) windows.push(describeWindow(usage.weekly, "Weekly"));
	if (usage.monthly) windows.push(describeWindow(usage.monthly, "Monthly"));
	return windows;
}

function parseWindow(window: UsageWindowInput | undefined): OpenCodeGoWindow | undefined {
	if (!window) return undefined;
	const usedPercent = finiteNumber(window.percent);
	if (usedPercent === undefined) return undefined;
	return { usedPercent, resetsAt: timestamp(window.resetsAt) };
}

function describeWindow(
	window: OpenCodeGoWindow,
	label: string,
): OpenCodeGoUsageWindowDescription {
	return {
		label,
		usedPercent: window.usedPercent,
		remainingPercent: remainingPercent(window.usedPercent),
		resetText: formatRemainingTime(window.resetsAt),
	};
}

function finiteNumber(value: NumericInput): number | undefined {
	const parsed = Number(value);
	return Number.isFinite(parsed) ? parsed : undefined;
}

function timestamp(value: TimestampInput | undefined): number | undefined {
	if (value === undefined) return undefined;
	if (stringInputValidator.Check(value)) {
		const parsed = Date.parse(value);
		return Number.isFinite(parsed) ? parsed : undefined;
	}
	return value < 10_000_000_000 ? value * 1000 : value;
}
