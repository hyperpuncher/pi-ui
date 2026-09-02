import { test } from "bun:test";

import { assertFalse, assertStringIncludes } from "#testing/assertions";

import { renderPromptStatus } from "./prompt-status.tsx";
import { appRenderSnapshot } from "./test-fixtures.ts";

test("context tooltip stays structured while usage is unavailable", () => {
	const html = renderPromptStatus(
		appRenderSnapshot({
			activityText: undefined,
			usage: {
				text: "$14.60 • ?/272k",
				costText: "$14.60",
				contextWindow: 272_000,
			},
		}),
	);

	assertStringIncludes(html, "Sending...");
	assertStringIncludes(html, 'data-tooltip="Context usage"');
	assertStringIncludes(html, "Available after next response");
	assertStringIncludes(html, "$14.60 session");
	assertFalse(html.includes('data-tooltip="$14.60 • ?/272k"'));
});
