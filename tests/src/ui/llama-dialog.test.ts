import { test } from "bun:test";

import { renderLlamaDialog } from "#src/ui/llama-dialog.tsx";
import { assertFalse, assertStringIncludes } from "#testing/assertions";

test("llama progress exposes its percentage to accessibility tools", () => {
	const html = renderLlamaDialog({
		models: [],
		progress: { label: "Loading model", ratio: 0.5 },
	});
	assertStringIncludes(html, 'aria-valuenow="50"');
	assertStringIncludes(html, 'aria-label="Loading model"');
});

test("unknown llama progress does not invent a percentage", () => {
	const html = renderLlamaDialog({
		models: [],
		progress: { label: "Loading model" },
	});
	assertFalse(html.includes("aria-valuenow="));
});
