import type { AgentSession } from "@earendil-works/pi-coding-agent";
import {
	compile,
	num,
	obj,
	opt,
	type Static,
	str,
	union,
} from "@earendil-works/pi-schema";

import { fetchProviderUsagePayload } from "#src/agent/provider-usage.ts";
import { describeLimitWindow } from "#src/agent/usage-format.ts";
import type { AppUsageLimitWindow } from "#src/state/app-store.ts";
import { isString, type JsonValue } from "#src/utils/type-guards.ts";

const opencodeGoProviderId = "opencode-go";
const opencodeGoUsageUrl = "https://opencode.ai/zen/go/v1/usage";
const numericInputSchema = union([num(), str({ pattern: "\\S" })]);
const usageWindowSchema = obj(
	{
		percent: numericInputSchema,
		resetsAt: opt(numericInputSchema),
	},
	{ open: true },
);
const openCodeGoPayloadSchema = obj(
	{
		usage: obj(
			{
				rolling: opt(usageWindowSchema),
				weekly: opt(usageWindowSchema),
				monthly: opt(usageWindowSchema),
			},
			{ open: true },
		),
	},
	{ open: true },
);
const openCodeGoPayloadValidator = compile(openCodeGoPayloadSchema);
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
	if (!openCodeGoPayloadValidator.check(payload)) return undefined;
	const parsed = {
		rolling: parseWindow(payload.usage.rolling),
		weekly: parseWindow(payload.usage.weekly),
		monthly: parseWindow(payload.usage.monthly),
	};
	return parsed.rolling || parsed.weekly || parsed.monthly ? parsed : undefined;
}

export function describeOpenCodeGoUsage(usage: OpenCodeGoUsage): AppUsageLimitWindow[] {
	const windows: AppUsageLimitWindow[] = [];
	if (usage.rolling) windows.push(describeWindow(usage.rolling, "5 hours"));
	if (usage.weekly) windows.push(describeWindow(usage.weekly, "Weekly"));
	if (usage.monthly) windows.push(describeWindow(usage.monthly, "Monthly"));
	return windows;
}

function parseWindow(window: UsageWindowInput | undefined): OpenCodeGoWindow | undefined {
	if (!window) return undefined;
	const usedPercent = Number(window.percent);
	if (!Number.isFinite(usedPercent)) return undefined;
	return { usedPercent, resetsAt: parseTimestamp(window.resetsAt) };
}

function parseTimestamp(value: UsageWindowInput["resetsAt"]): number | undefined {
	if (value === undefined) return undefined;
	if (isString(value)) {
		const parsed = Date.parse(value);
		return Number.isFinite(parsed) ? parsed : undefined;
	}
	return value < 10_000_000_000 ? value * 1000 : value;
}

function describeWindow(window: OpenCodeGoWindow, label: string): AppUsageLimitWindow {
	return describeLimitWindow(label, window.usedPercent, window.resetsAt);
}
