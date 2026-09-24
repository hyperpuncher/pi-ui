import { test } from "bun:test";

import { assert, assertFalse, assertStringIncludes } from "#testing/assertions";

import { shouldAutofocusPromptOnLoad } from "./autofocus.js";

test("autofocus only fires for a real hover-capable, fine pointer", () => {
	const queries: string[] = [];
	const fineHoverCapable = shouldAutofocusPromptOnLoad((query: string) => {
		queries.push(query);
		return { matches: true } as MediaQueryList;
	});
	assertStringIncludes(queries[0] ?? "", "hover: hover");
	assertStringIncludes(queries[0] ?? "", "pointer: fine");
	assert(fineHoverCapable);
});

test("autofocus is skipped on coarse/touch-only devices", () => {
	const coarseOrTouch = shouldAutofocusPromptOnLoad(
		() => ({ matches: false }) as MediaQueryList,
	);
	assertFalse(coarseOrTouch);
});
