import { test } from "bun:test";

import { fuzzyFilter } from "@earendil-works/pi-tui/dist/fuzzy.js";

import { modelSearchText } from "#static/app/model-search.js";
import { assertEquals } from "#testing/assertions";

test("model search ranks DeepSeek above Claude Sonnet for ds4", () => {
	const models = [
		{
			id: "claude-sonnet-4",
			provider: "opencode",
			name: "Claude Sonnet 4",
		},
		{
			id: "deepseek-v4-flash",
			provider: "opencode",
			name: "DeepSeek V4 Flash",
		},
	];
	assertEquals(
		fuzzyFilter(models, "ds4", (model) =>
			modelSearchText(model.id, model.provider, model.name),
		),
		[models[1], models[0]],
	);
});

test("model search matches provider and combined provider/model terms", () => {
	const model = { id: "gpt-5.6", provider: "openai-codex", name: "GPT 5.6" };
	const search = (item: typeof model) =>
		modelSearchText(item.id, item.provider, item.name);
	assertEquals(fuzzyFilter([model], "opai g56", search), [model]);
	assertEquals(fuzzyFilter([model], "openai-codex/gpt-5.6", search), [model]);
});
