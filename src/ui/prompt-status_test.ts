import { test } from "bun:test";

import { assertStringIncludes } from "#testing/assertions";

import { renderUsageIndicators } from "./prompt-status.tsx";
import { appRenderSnapshot } from "./test-fixtures.ts";

test("usage fallback explains unavailable context and preserves session cost", () => {
	const snapshot = appRenderSnapshot({
		activityText: undefined,
		usage: {
			text: "$14.60 • ?/272k",
			costText: "$14.60",
			contextWindow: 272_000,
		},
	});
	const usageHtml = renderUsageIndicators(snapshot.usage);

	assertStringIncludes(usageHtml, "Available after next response");
	assertStringIncludes(usageHtml, "$14.60 session");
});
