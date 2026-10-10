import { test } from "bun:test";

import { AppStore } from "#src/state/app-store.ts";
import { renderModelOptions, renderModelPicker } from "#src/ui/prompt-pickers.tsx";
import { modelSearchText } from "#src/utils/model-search.ts";
import { assertFalse, assertStringIncludes } from "#testing/assertions";

test("model search text includes name, id and provider", () => {
	const search = modelSearchText("deepseek-v4-flash", "opencode", "DeepSeek V4 Flash");
	assertStringIncludes(search, "DeepSeek V4 Flash");
	assertStringIncludes(search, "deepseek-v4-flash");
	assertStringIncludes(search, "opencode");
});

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
	assertStringIncludes(html, "data-bind:model-search");
	assertStringIncludes(html, 'id="model-select-options"');
	assertStringIncludes(html, "data-ignore-morph");
	assertStringIncludes(html, 'id="model-scope-star"');
	assertStringIncludes(html, "/models/list");
	assertFalse(html.includes("model-option-"));
	assertFalse(html.includes("/models/search"));
});

test("model rows render prefiltered without per row effects", () => {
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
	const snapshot = store.snapshot();
	const html = renderModelOptions(snapshot.models, snapshot.currentModel);
	assertStringIncludes(html, 'id="model-option-opencode%2Fdeepseek-v4-flash"');
	assertStringIncludes(html, 'class="model-choice active"');
	assertFalse(html.includes("data-attr:hidden="));
	assertFalse(html.includes("window.piUi.fuzzy"));
	assertStringIncludes(html, 'data-model-value="opencode/deepseek-v4-flash"');
	assertStringIncludes(html, 'href="#model-scope-star"');
});
