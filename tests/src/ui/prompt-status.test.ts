import { expect, test } from "bun:test";

import { renderUsageIndicators } from "#src/ui/prompt-status.tsx";
import { assertStringIncludes } from "#testing/assertions";

test("usage fallback explains unavailable context and includes non-zero compactions", () => {
	const emptyHtml = renderUsageIndicators({
		text: "$14.60 • ?/272k",
		costText: "$14.60",
		contextWindow: 272_000,
	});

	assertStringIncludes(emptyHtml, "Available after next response");
	assertStringIncludes(emptyHtml, ">$14.60</span>");
	expect(emptyHtml).not.toContain("compaction");

	const compactedHtml = renderUsageIndicators({
		text: "$14.60 • ?/272k",
		costText: "$14.60",
		contextWindow: 272_000,
		compactionCount: 1,
	});

	assertStringIncludes(compactedHtml, "1 compaction · $14.60");
});

test("context usage tooltip shows inline compaction count only when non-zero", () => {
	const zeroHtml = renderUsageIndicators({
		text: "$0.000 • 12.2%/1.0M",
		costText: "$0.000",
		contextPercent: 12.2,
		contextTokens: 122_000,
		contextWindow: 1_000_000,
		cacheHitPercent: 95.3,
		compactionCount: 0,
	});

	assertStringIncludes(zeroHtml, "95.3% cache hit");
	assertStringIncludes(zeroHtml, "<span>$0.000</span>");
	expect(zeroHtml).not.toContain("compaction");

	const compactedHtml = renderUsageIndicators({
		text: "$562 • 14.7%/1.0M",
		costText: "$562",
		contextPercent: 14.7,
		contextTokens: 147_000,
		contextWindow: 1_000_000,
		cacheHitPercent: 98.3,
		compactionCount: 50,
	});

	assertStringIncludes(compactedHtml, "98.3% cache hit · 50 compactions");
	assertStringIncludes(compactedHtml, "<span>$562</span>");
});
