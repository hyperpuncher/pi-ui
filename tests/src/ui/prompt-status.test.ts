import { test } from "bun:test";

import { renderUsageIndicators } from "#src/ui/prompt-status.tsx";
import { assertStringIncludes } from "#testing/assertions";

test("usage fallback explains unavailable context and preserves session cost", () => {
	const usageHtml = renderUsageIndicators({
		text: "$14.60 • ?/272k",
		costText: "$14.60",
		contextWindow: 272_000,
	});

	assertStringIncludes(usageHtml, "Available after next response");
	assertStringIncludes(usageHtml, "$14.60 session");
});
