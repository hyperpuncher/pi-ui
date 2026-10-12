import { test } from "bun:test";

import { renderLlamaDialog } from "#src/ui/llama-dialog.tsx";
import { assertFalse, assertStringIncludes } from "#testing/assertions";

test.each([0, 0.5, 1])(
	"llama progress keeps its value while scaling the fill at %s",
	(ratio) => {
		const html = renderLlamaDialog({
			models: [],
			progress: { label: "Loading model", ratio },
		});
		assertStringIncludes(html, `transform: scaleX(${ratio})`);
		assertStringIncludes(html, `aria-valuenow="${ratio * 100}"`);
		assertStringIncludes(html, 'aria-label="Loading model"');
		assertStringIncludes(html, 'role="progressbar"');
		assertFalse(html.includes('style="width:'));
	},
);

test("llama progress with no ratio stays indeterminate", () => {
	const html = renderLlamaDialog({
		models: [],
		progress: { label: "Loading model" },
	});
	assertStringIncludes(html, "transform: scaleX(0)");
	assertStringIncludes(html, 'role="progressbar"');
	assertFalse(html.includes("aria-valuenow="));
});
