import { test } from "bun:test";

import { assertEquals } from "#testing/assertions";

import type { AppUsage } from "../state/app-store.ts";
import { agentSessionRuntimeStub } from "./test-fixtures.ts";
import { cumulativeCacheHitPercent, UsageController } from "./usage-controller.ts";

test("keeps cached Codex usage through failed refreshes and model switches", async () => {
	let failure: "empty" | "timeout" | undefined;
	let usedPercent = 22;
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
	const runtime = agentSessionRuntimeStub({ session });
	const state = {
		setUsage: (usage: AppUsage) => {
			rendered = usage;
		},
	};
	const controller = new UsageController(
		() => runtime,
		state,
		async () => {
			if (failure === "timeout")
				throw new DOMException("The operation was aborted.", "AbortError");
			if (failure === "empty") return undefined;
			return { primary: { usedPercent, windowSeconds: 604_800 } };
		},
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

	for (const outcome of ["timeout", "empty"] as const) {
		failure = outcome;
		controller.refresh(true);
		await new Promise((resolve) => setTimeout(resolve, 0));
		assertEquals(rendered?.limits?.windows[0]?.remainingPercent, 78);
	}
	failure = undefined;
	usedPercent = 23;
	controller.refresh(true);
	await new Promise((resolve) => setTimeout(resolve, 0));
	assertEquals(rendered?.limits?.windows[0]?.remainingPercent, 77);

	model = { provider: "anthropic", id: "claude" };
	controller.suspend();
	controller.sync();
	assertEquals(rendered?.limits, undefined);

	model = codexModel;
	controller.suspend();
	controller.sync();
	assertEquals(rendered?.limits?.windows[0]?.remainingPercent, 77);
	controller.dispose();
});

test("shows OpenCode Go usage and retains it after an unavailable refresh", async () => {
	let available = false;
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
	const runtime = agentSessionRuntimeStub({ session });
	const state = {
		setUsage: (usage: AppUsage) => {
			rendered = usage;
		},
	};
	const controller = new UsageController(
		() => runtime,
		state,
		async () => undefined,
		async () =>
			available
				? {
						rolling: { usedPercent: 12 },
						weekly: { usedPercent: 8 },
						monthly: { usedPercent: 35 },
					}
				: undefined,
	);

	controller.refresh();
	await new Promise((resolve) => setTimeout(resolve, 0));
	assertEquals(rendered?.limits?.status, "unavailable");
	available = true;
	controller.refresh(true);
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
	available = false;
	controller.refresh(true);
	await new Promise((resolve) => setTimeout(resolve, 0));
	assertEquals(rendered?.limits?.windows[0]?.remainingPercent, 88);
	controller.dispose();
});

test("uses the cumulative session cache hit rate", () => {
	assertEquals(
		cumulativeCacheHitPercent({
			tokens: {
				input: 40,
				output: 20,
				cacheRead: 150,
				cacheWrite: 10,
				total: 220,
			},
		}),
		75,
	);
	assertEquals(
		cumulativeCacheHitPercent({
			tokens: {
				input: 0,
				output: 20,
				cacheRead: 0,
				cacheWrite: 0,
				total: 20,
			},
		}),
		undefined,
	);
});
