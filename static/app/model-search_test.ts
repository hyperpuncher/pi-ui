import { fuzzyFilter } from "@earendil-works/pi-tui/dist/fuzzy.js";
import { assertEquals } from "@std/assert";

import { modelSearchText } from "./model-search.js";

Deno.test("model search ranks DeepSeek above Claude Sonnet for ds4", () => {
	const models = [
		{
			filter: "claude-sonnet-4 opencode",
			name: "Claude Sonnet 4",
		},
		{
			filter: "deepseek-v4-flash opencode",
			name: "DeepSeek V4 Flash",
		},
	];
	assertEquals(
		fuzzyFilter(models, "ds4", (model) => modelSearchText(model.filter, model.name)),
		[models[1], models[0]],
	);
});

Deno.test("model search matches provider and combined provider/model terms", () => {
	const model = { filter: "gpt-5.6 openai-codex", name: "GPT 5.6" };
	const search = (item: typeof model) => modelSearchText(item.filter, item.name);
	assertEquals(fuzzyFilter([model], "opai g56", search), [model]);
	assertEquals(fuzzyFilter([model], "openai-codex/gpt-5.6", search), [model]);
});
