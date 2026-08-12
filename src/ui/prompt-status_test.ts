import { assertFalse, assertStringIncludes } from "@std/assert";

import type { AppRenderSnapshot } from "../state/app-store.ts";
import { renderPromptStatus } from "./prompt-status.tsx";

Deno.test("context tooltip stays structured while usage is unavailable", () => {
	const html = renderPromptStatus({
		activityText: undefined,
		usage: {
			text: "$14.60 • ?/272k",
			costText: "$14.60",
			contextWindow: 272_000,
		},
	} as unknown as AppRenderSnapshot);

	assertStringIncludes(html, 'data-tooltip="Context usage"');
	assertStringIncludes(html, 'data-slot="tooltip-content"');
	assertStringIncludes(html, "Available after next response");
	assertStringIncludes(html, "$14.60 session");
	assertFalse(html.includes('data-tooltip="$14.60 • ?/272k"'));
});
