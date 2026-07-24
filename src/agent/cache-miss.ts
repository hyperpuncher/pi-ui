import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";

/** Anthropic's default prompt-cache lifetime. */
export const cacheTtlMs = 5 * 60 * 1000;

const noiseFloorTokens = 1_024;
const noticeTokenThreshold = 20_000;
const noticeCostThreshold = 0.1;

export type CacheMiss = {
	missedTokens: number;
	missedCost: number;
	idleMs: number;
	modelChanged: boolean;
};

export type CacheModelSource = {
	getModel(
		provider: string,
		modelId: string,
	): { cost: { cacheRead: number } } | undefined;
};

type PreviousRequest = {
	promptTokens: number;
	modelKey: string;
	timestamp: number;
	reportedCache: boolean;
};

export function collectCacheMisses(
	entries: readonly SessionEntry[],
	models: CacheModelSource,
): Map<AssistantMessage, CacheMiss> {
	const misses = new Map<AssistantMessage, CacheMiss>();
	let previous: PreviousRequest | undefined;
	for (const entry of entries) {
		if (entry.type === "compaction" || entry.type === "branch_summary") {
			previous = undefined;
			continue;
		}
		if (entry.type !== "message" || entry.message.role !== "assistant") continue;
		const miss = detectMiss(previous, entry.message, models);
		if (miss) misses.set(entry.message, miss);
		previous =
			asPreviousRequest(entry.message, previous?.reportedCache ?? false) ??
			previous;
	}
	return misses;
}

/** `entries` must not contain `message` yet, as with pi's `message_end` event. */
export function detectCacheMiss(
	entries: readonly SessionEntry[],
	message: AssistantMessage,
	models: CacheModelSource,
): CacheMiss | undefined {
	let previous: PreviousRequest | undefined;
	for (const entry of entries) {
		if (entry.type === "compaction" || entry.type === "branch_summary") {
			previous = undefined;
		} else if (entry.type === "message" && entry.message.role === "assistant") {
			previous =
				asPreviousRequest(entry.message, previous?.reportedCache ?? false) ??
				previous;
		}
	}
	return detectMiss(previous, message, models);
}

export function formatCacheMissNotice(miss: CacheMiss): string | undefined {
	if (miss.missedTokens < noticeTokenThreshold && miss.missedCost < noticeCostThreshold)
		return undefined;
	const cost = miss.missedCost >= 0.01 ? ` (~$${miss.missedCost.toFixed(2)})` : "";
	let label = "cache miss";
	if (miss.modelChanged) label = "cache miss after model switch";
	else if (miss.idleMs >= cacheTtlMs) {
		label = `cache miss after ${Math.round(miss.idleMs / 60_000)}m idle`;
	}
	return `${label}: ${formatTokens(miss.missedTokens)} tokens re-billed${cost}`;
}

function detectMiss(
	previous: PreviousRequest | undefined,
	message: AssistantMessage,
	models: CacheModelSource,
): CacheMiss | undefined {
	const usage = message.usage;
	const promptTokens = usage.input + usage.cacheRead + usage.cacheWrite;
	if (
		!previous ||
		promptTokens <= 0 ||
		(usage.cacheRead + usage.cacheWrite === 0 && !previous.reportedCache)
	)
		return undefined;

	const missedTokens = Math.min(previous.promptTokens, promptTokens) - usage.cacheRead;
	if (missedTokens <= noiseFloorTokens) return undefined;

	const paidTokens = usage.input + usage.cacheWrite;
	const paidPerToken =
		paidTokens > 0 ? (usage.cost.input + usage.cost.cacheWrite) / paidTokens : 0;
	const readPerToken =
		usage.cacheRead > 0
			? usage.cost.cacheRead / usage.cacheRead
			: (models.getModel(message.provider, message.model)?.cost.cacheRead ?? 0) /
				1_000_000;
	return {
		missedTokens,
		missedCost: missedTokens * Math.max(0, paidPerToken - readPerToken),
		idleMs: Math.max(0, message.timestamp - previous.timestamp),
		modelChanged: `${message.provider}/${message.model}` !== previous.modelKey,
	};
}

function asPreviousRequest(
	message: AssistantMessage,
	reportedCache: boolean,
): PreviousRequest | undefined {
	const usage = message.usage;
	const promptTokens = usage.input + usage.cacheRead + usage.cacheWrite;
	if (promptTokens <= 0) return undefined;
	return {
		promptTokens,
		modelKey: `${message.provider}/${message.model}`,
		timestamp: message.timestamp,
		reportedCache: reportedCache || usage.cacheRead + usage.cacheWrite > 0,
	};
}

function formatTokens(count: number): string {
	if (count < 1_000) return count.toString();
	if (count < 10_000) return `${(count / 1_000).toFixed(1)}k`;
	if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
	if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
	return `${Math.round(count / 1_000_000)}M`;
}
