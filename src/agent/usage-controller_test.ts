import type { AgentSessionRuntime, SessionEntry } from "@earendil-works/pi-coding-agent";
import { assertEquals } from "@std/assert";

import type { AppStore, AppUsage } from "../state/app-store.ts";
import { latestCacheHitPercent, UsageController } from "./usage-controller.ts";

Deno.test("keeps cached Codex usage while switching models", async () => {
	const codexModel = { provider: "openai-codex", id: "gpt-5" };
	let model = codexModel;
	let rendered: AppUsage | undefined;
	const session = {
		get model() {
			return model;
		},
		getSessionStats: () => ({
			cost: 0,
			tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			contextUsage: null,
		}),
		sessionManager: { getEntries: () => [] },
	};
	const runtime = { session } as unknown as AgentSessionRuntime;
	const state = {
		setUsage: (usage: AppUsage) => {
			rendered = usage;
		},
	} as unknown as AppStore;
	const controller = new UsageController(
		() => runtime,
		state,
		async () => ({
			primary: { usedPercent: 22, windowSeconds: 604_800 },
		}),
	);

	controller.refresh();
	await new Promise((resolve) => setTimeout(resolve, 0));
	assertEquals(rendered?.limits, {
		label: "Codex limits",
		status: undefined,
		windows: [
			{
				label: "Weekly",
				usedPercent: 22,
				remainingPercent: 78,
				resetText: "?",
			},
		],
	});

	model = { provider: "anthropic", id: "claude" };
	controller.suspend();
	controller.sync();
	assertEquals(rendered?.limits, undefined);

	model = codexModel;
	controller.suspend();
	controller.sync();
	assertEquals(rendered?.limits?.windows[0]?.remainingPercent, 78);
	controller.dispose();
});

Deno.test("shows OpenCode Go usage for OpenCode Go models", async () => {
	const model = { provider: "opencode-go", id: "kimi-k2.5" };
	let rendered: AppUsage | undefined;
	const session = {
		model,
		getSessionStats: () => ({
			cost: 0,
			tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			contextUsage: null,
		}),
		sessionManager: { getEntries: () => [] },
	};
	const runtime = { session } as unknown as AgentSessionRuntime;
	const state = {
		setUsage: (usage: AppUsage) => {
			rendered = usage;
		},
	} as unknown as AppStore;
	const controller = new UsageController(
		() => runtime,
		state,
		async () => undefined,
		async () => ({
			rolling: { usedPercent: 12 },
			weekly: { usedPercent: 8 },
			monthly: { usedPercent: 35 },
		}),
	);

	controller.refresh();
	await new Promise((resolve) => setTimeout(resolve, 0));
	assertEquals(rendered?.limits, {
		label: "OpenCode Go usage",
		status: undefined,
		windows: [
			{
				label: "5 hours",
				usedPercent: 12,
				remainingPercent: 88,
				resetText: "?",
			},
			{
				label: "Weekly",
				usedPercent: 8,
				remainingPercent: 92,
				resetText: "?",
			},
			{
				label: "Monthly",
				usedPercent: 35,
				remainingPercent: 65,
				resetText: "?",
			},
		],
	});
	controller.dispose();
});

Deno.test("uses the latest assistant prompt cache hit rate", () => {
	const entries = [
		{
			type: "message",
			message: {
				role: "assistant",
				usage: { input: 30, cacheRead: 70, cacheWrite: 0 },
			},
		},
		{
			type: "message",
			message: { role: "user" },
		},
		{
			type: "message",
			message: {
				role: "assistant",
				usage: { input: 10, cacheRead: 80, cacheWrite: 10 },
			},
		},
	] as unknown as SessionEntry[];

	assertEquals(latestCacheHitPercent(entries), 80);
	assertEquals(latestCacheHitPercent([]), undefined);
});
