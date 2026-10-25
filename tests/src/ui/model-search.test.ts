import { test } from "bun:test";

import { AppStore } from "#src/state/app-store.ts";
import { renderModelPicker } from "#src/ui/prompt-pickers.tsx";
import { assertFalse, assertStringIncludes } from "#testing/assertions";

test("model picker shell loads rows on open instead of every view", () => {
	const store = new AppStore();
	store.setModels(
		[
			{
				id: "deepseek-v4-flash",
				provider: "opencode",
				name: "DeepSeek V4 Flash",
				configured: true,
				scoped: false,
			},
		],
		undefined,
	);
	const html = renderModelPicker(store.snapshot());
	assertStringIncludes(html, 'id="model-select-options"');
	assertStringIncludes(html, "/models/list");
	assertFalse(html.includes("model-option-"));
});
