import type { AgentSession } from "@earendil-works/pi-coding-agent";

import { asRecord } from "../utils/type-guards.ts";
import { fetchProviderUsagePayload } from "./provider-usage.ts";

const opencodeGoProviderId = "opencode-go";
const opencodeGoUsageUrl = "https://opencode.ai/zen/go/v1/usage";
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

export function parseOpenCodeGoUsage(payload: unknown): OpenCodeGoUsage | undefined {
	const root = asRecord(payload);
	const usage = asRecord(root?.usage);
	if (!usage) return undefined;

	const parsed = {
		rolling: parseWindow(usage.rolling),
		weekly: parseWindow(usage.weekly),
		monthly: parseWindow(usage.monthly),
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

function parseWindow(value: unknown): OpenCodeGoWindow | undefined {
	const window = asRecord(value);
	if (!window) return undefined;
	const usedPercent = asNumber(window.percent);
	if (usedPercent === undefined) return undefined;
	return { usedPercent, resetsAt: asTimestamp(window.resetsAt) };
}

function describeWindow(
	window: OpenCodeGoWindow,
	label: string,
): OpenCodeGoUsageWindowDescription {
	return {
		label,
		usedPercent: window.usedPercent,
		remainingPercent: Math.round(100 - clampPercent(window.usedPercent)),
		resetText: formatRemainingTime(window.resetsAt),
	};
}

function formatRemainingTime(resetsAt: number | undefined): string {
	if (!resetsAt) return "?";
	const minutes = Math.max(0, resetsAt - Date.now()) / 60_000;
	if (minutes < 60) return `${Math.round(minutes)}m`;
	const hours = minutes / 60;
	if (hours < 24) return `${formatOneDecimal(hours)}h`;
	return `${formatOneDecimal(hours / 24)}d`;
}

function asNumber(value: unknown): number | undefined {
	if (typeof value === "number" && Number.isFinite(value)) return value;
	if (typeof value === "string" && value.trim()) {
		const parsed = Number(value);
		if (Number.isFinite(parsed)) return parsed;
	}
	return undefined;
}

function asTimestamp(value: unknown): number | undefined {
	if (typeof value === "string") {
		const parsed = Date.parse(value);
		return Number.isFinite(parsed) ? parsed : undefined;
	}
	const parsed = asNumber(value);
	if (parsed === undefined) return undefined;
	return parsed < 10_000_000_000 ? parsed * 1000 : parsed;
}

function clampPercent(value: number): number {
	return Math.min(100, Math.max(0, value));
}

function formatOneDecimal(value: number): string {
	const rounded = Math.round(value * 10) / 10;
	return Number.isInteger(rounded) ? String(rounded) : rounded.toFixed(1);
}
