import {
	CACHE_TTL_MS,
	collectCacheMisses,
	detectCacheMiss,
	type CacheMiss,
} from "#pi/core/cache-stats.js";
import { formatTokens } from "#src/utils/format.ts";

const noticeTokenThreshold = 20_000;
const noticeCostThreshold = 0.1;

export { collectCacheMisses, detectCacheMiss };
export type { CacheMiss };

export function formatCacheMissNotice(
	miss: CacheMiss,
): { title: string; text: string } | undefined {
	if (miss.missedTokens < noticeTokenThreshold && miss.missedCost < noticeCostThreshold)
		return undefined;
	const cost = miss.missedCost >= 0.01 ? ` (~$${miss.missedCost.toFixed(2)})` : "";
	let label = "cache miss";
	if (miss.modelChanged) label = "cache miss after model switch";
	else if (miss.idleMs >= CACHE_TTL_MS) {
		label = `cache miss after ${Math.round(miss.idleMs / 60_000)}m idle`;
	}
	return {
		title: label,
		text: `${formatTokens(miss.missedTokens)} tokens re-billed${cost}`,
	};
}
