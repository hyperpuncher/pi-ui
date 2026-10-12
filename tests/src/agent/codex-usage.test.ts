import { onTestFinished, spyOn, test } from "bun:test";

import { InMemoryCredentialStore } from "@earendil-works/pi-ai";
import { ModelRuntime } from "@earendil-works/pi-coding-agent";

import {
	fetchCodexUsage,
	formatCodexUsage,
	parseCodexUsage,
} from "#src/agent/codex-usage.ts";
import { assertEquals, assertRejects } from "#testing/assertions";

import { agentSessionRuntimeStub } from "./test-fixtures.ts";

test("uses legacy auth for Codex limits with an OpenAI model", async () => {
	const credentials = new InMemoryCredentialStore();
	for (const provider of ["openai", "openai-codex"]) {
		await credentials.modify(provider, async () => ({
			type: "oauth",
			access: provider,
			refresh: "unused",
			expires: Date.now() + 3_600_000,
		}));
	}
	const modelRuntime = await ModelRuntime.create({
		credentials,
		modelsPath: null,
		refreshOnCreate: false,
	});
	const session = agentSessionRuntimeStub({
		session: { model: modelRuntime.getModels("openai")[0], modelRuntime },
	}).session;
	let status = 200;
	const fetchSpy = spyOn(globalThis, "fetch").mockImplementation(
		Object.assign(
			async (url: RequestInfo | URL, init?: RequestInit) => {
				assertEquals(String(url), "https://chatgpt.com/backend-api/wham/usage");
				assertEquals(
					new Headers(init?.headers).get("authorization"),
					"Bearer openai-codex",
				);
				return Response.json(
					{
						rate_limit: { primary_window: { used_percent: 22 } },
					},
					{ status },
				);
			},
			{ preconnect: () => {} },
		),
	);
	onTestFinished(() => fetchSpy.mockRestore());

	assertEquals((await fetchCodexUsage(session))?.primary?.usedPercent, 22);
	assertEquals(fetchSpy.mock.calls.length, 1);
	status = 401;
	await assertRejects(() => fetchCodexUsage(session), Error, "HTTP 401");
});

test("parses available Codex windows independently", () => {
	assertEquals(
		parseCodexUsage({
			rate_limit: {
				primary_window: {
					used_percent: "22",
					limit_window_seconds: 18_000,
					reset_at: null,
				},
				secondary_window: null,
			},
		}),
		{
			primary: {
				usedPercent: 22,
				windowSeconds: 18_000,
				resetsAt: undefined,
			},
			secondary: undefined,
		},
	);
});

test("keeps valid Codex windows when another window is malformed", () => {
	assertEquals(
		parseCodexUsage({
			rate_limit: {
				primary_window: { used_percent: 10 },
				secondary_window: { used_percent: "invalid" },
			},
		}),
		{
			primary: {
				usedPercent: 10,
				windowSeconds: undefined,
				resetsAt: undefined,
			},
			secondary: undefined,
		},
	);
});

test("formats Codex windows from their reported duration", () => {
	assertEquals(
		formatCodexUsage({
			primary: { usedPercent: 22, windowSeconds: 604_800 },
		}),
		"Weekly 78% ?",
	);
	assertEquals(
		formatCodexUsage({
			primary: { usedPercent: 25, windowSeconds: 18_000 },
			secondary: { usedPercent: 50, windowSeconds: 604_800 },
		}),
		"5 hours 75% ?  Weekly 50% ?",
	);
});

test("uses legacy labels when Codex omits window durations", () => {
	assertEquals(
		formatCodexUsage({
			primary: { usedPercent: 10 },
			secondary: { usedPercent: 20 },
		}),
		"5 hours 90% ?  Weekly 80% ?",
	);
});
