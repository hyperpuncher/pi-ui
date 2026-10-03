import { test } from "bun:test";

import type { AssistantMessage, SimpleStreamOptions } from "@earendil-works/pi-ai";

import {
	defaultAutoTitleConfig,
	generateAutoTitle,
	parseAutoTitleConfig,
	sanitizeTitle,
} from "#src/agent/auto-title.ts";
import { assertEquals, assertStringIncludes } from "#testing/assertions";

import { agentSessionRuntimeStub } from "./test-fixtures.ts";

type TitleModelRuntime = {
	getAvailableSnapshot(): Array<{ provider: string; id: string }>;
	completeSimple(
		model: { provider: string; id: string },
		context: { systemPrompt: string; messages: Array<{ content: string }> },
		options: SimpleStreamOptions,
	): Promise<Pick<AssistantMessage, "stopReason" | "content">>;
};

function titleRuntime(modelRuntime: TitleModelRuntime) {
	return agentSessionRuntimeStub({
		session: {
			sessionManager: {
				isPersisted: () => true,
				getSessionId: () => "title-session",
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
			agent: {
				state: { messages: [{ role: "user", content: "Compacted context" }] },
			},
		},
		services: { modelRuntime },
	});
}

test("auto-title config prefers deepseek with luna fallbacks and accepts a custom prompt", () => {
	assertEquals(parseAutoTitleConfig(undefined), defaultAutoTitleConfig);
	assertEquals(defaultAutoTitleConfig.models, [
		"opencode-go/deepseek-v4.1-flash:low",
		"openai/gpt-5.6-luna:low",
		"openai-codex/gpt-5.6-luna:low",
	]);
	assertEquals(
		parseAutoTitleConfig({
			enabled: true,
			models: [" test/valid "],
			prompt: " use lowercase ",
		}),
		{
			enabled: true,
			models: ["test/valid"],
			prompt: "use lowercase",
		},
	);
});

test("titles use the persisted first message and skip unavailable or invalid candidates", async () => {
	let calls = 0;
	const model = { provider: "test", id: "valid" };
	const runtime = titleRuntime({
		// Unauthenticated models are absent from this snapshot.
		getAvailableSnapshot: () => [model],
		completeSimple: async (selected, context, options) => {
			calls++;
			assertEquals(selected, model);
			assertStringIncludes(context.systemPrompt, "use lowercase");
			assertStringIncludes(
				context.messages[0]?.content ?? "",
				"Add session title generation",
			);
			assertEquals(
				context.messages[0]?.content.includes("Compacted context"),
				false,
			);
			assertEquals(options, {
				reasoning: undefined,
				maxTokens: 2048,
				maxRetries: 0,
				timeoutMs: 30_000,
				sessionId: "title-session",
			});
			return {
				stopReason: "stop",
				content: [{ type: "text", text: '"lowercase session titles"' }],
			};
		},
	});
	assertEquals(
		await generateAutoTitle(runtime, {
			...defaultAutoTitleConfig,
			models: ["test/unauthenticated:low", "test/valid:invalid", "test/valid"],
		}),
		"lowercase session titles",
	);
	assertEquals(calls, 1);
});

test("generated titles are cleaned without losing content", () => {
	assertEquals(sanitizeTitle("Title: a useful title"), "a useful title");
	const longTitle =
		"a title that is much too long to fit in the narrow session sidebar";
	assertEquals(sanitizeTitle(longTitle), longTitle);
});

for (const level of ["off", "low", "high"] as const) {
	test(`title fallback preserves ${level} reasoning and rejects failed or invalid responses`, async () => {
		const responses = [
			["throws", "error", ""],
			["error", "error", "ignored"],
			["aborted", "aborted", "ignored"],
			["deferred", "deferred", "ignored"],
			["length", "length", "incomplete title"],
			["empty", "stop", ""],
			["question", "stop", "fix titles?"],
			["valid", "stop", "fix title generation"],
		] as const;
		const calls: Array<{ id: string; reasoning: string | undefined }> = [];
		const runtime = titleRuntime({
			getAvailableSnapshot: () =>
				responses.map(([id]) => ({ provider: "test", id })),
			completeSimple: async (model, _context, options) => {
				calls.push({ id: model.id, reasoning: options.reasoning });
				if (model.id === "throws") throw new Error("unavailable");
				const [, stopReason, text] = responses.find(([id]) => id === model.id)!;
				return { stopReason, content: [{ type: "text", text }] };
			},
		});
		assertEquals(
			await generateAutoTitle(runtime, {
				...defaultAutoTitleConfig,
				models: responses.map(([id]) => `test/${id}:${level}`),
			}),
			"fix title generation",
		);
		assertEquals(
			calls,
			responses.map(([id]) => ({
				id,
				reasoning: level === "off" ? undefined : level,
			})),
		);
	});
}
