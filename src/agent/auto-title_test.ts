import { test } from "bun:test";

import { assertEquals, assertStringIncludes } from "#testing/assertions";

import {
	defaultAutoTitleConfig,
	generateAutoTitle,
	parseAutoTitleConfig,
	sanitizeTitle,
} from "./auto-title.ts";
import { agentSessionRuntimeStub } from "./test-fixtures.ts";

test("auto-title config uses luna defaults and accepts a custom prompt", () => {
	assertEquals(parseAutoTitleConfig(undefined), defaultAutoTitleConfig);
	assertEquals(
		parseAutoTitleConfig({
			enabled: true,
			models: ["openrouter/openai/gpt-5.6-luna"],
			prompt: " use lowercase ",
		}),
		{
			enabled: true,
			models: ["openrouter/openai/gpt-5.6-luna"],
			prompt: "use lowercase",
		},
	);
});

test("generated titles start before an assistant response", async () => {
	let selected: { provider: string; id: string } | undefined;
	let systemPrompt = "";
	let request = "";
	const messages = [{ role: "user", content: "Compacted context", timestamp: 1 }];
	const runtime = agentSessionRuntimeStub({
		session: {
			sessionManager: {
				isPersisted: () => true,
				getSessionName: () => undefined,
				getEntries: () => [
					{
						type: "message",
						message: {
							role: "user",
							content: "Add session title generation",
						},
					},
				],
			},
			agent: { state: { messages } },
		},
		services: {
			modelRuntime: {
				getAvailableSnapshot: () => [
					{ provider: "openrouter", id: "openai/gpt-5.6-luna" },
				],
				getModel: () => ({
					provider: "openrouter",
					id: "openai/gpt-5.6-luna",
				}),
				completeSimple: (
					model: { provider: string; id: string },
					context: {
						systemPrompt: string;
						messages: Array<{ content: string }>;
					},
				) => {
					selected = model;
					systemPrompt = context.systemPrompt;
					request = context.messages[0]?.content ?? "";
					return Promise.resolve({
						content: [{ type: "text", text: '"lowercase session titles"' }],
						stopReason: "stop",
					});
				},
			},
		},
	});

	const title = await generateAutoTitle(runtime, {
		...defaultAutoTitleConfig,
		models: ["openrouter/openai/gpt-5.6-luna"],
		prompt: "use lowercase",
	});

	assertEquals(selected, {
		provider: "openrouter",
		id: "openai/gpt-5.6-luna",
	});
	assertStringIncludes(systemPrompt, "use lowercase");
	assertStringIncludes(request, "Add session title generation");
	assertEquals(request.includes("Compacted context"), false);
	assertEquals(title, "lowercase session titles");
});

test("generated titles are cleaned without losing content", () => {
	assertEquals(sanitizeTitle("Title: a useful title"), "a useful title");
	assertEquals(
		sanitizeTitle(
			"a title that is much too long to fit in the narrow session sidebar",
		),
		"a title that is much too long to fit in the narrow session sidebar",
	);
});
