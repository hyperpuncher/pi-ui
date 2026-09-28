import { onTestFinished, spyOn, test } from "bun:test";

import {
	cumulativeCacheHitPercent,
	UsageController,
} from "#src/agent/usage-controller.ts";
import type { AppUsage } from "#src/state/app-store.ts";
import { assertEquals } from "#testing/assertions";

import { agentSessionRuntimeStub } from "./test-fixtures.ts";

const sessionStats = {
	getSessionStats: () => ({
		cost: 0,
		tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		contextUsage: null,
	}),
	sessionManager: { getEntries: () => [] },
};

type UsageSession = {
	model?: { provider?: string; id?: string };
	getSessionStats: () => {
		cost: number;
		tokens: {
			input: number;
			output: number;
			cacheRead: number;
			cacheWrite: number;
			total: number;
		};
		contextUsage: null;
	};
	sessionManager: { getEntries: () => unknown[] };
};

const flush = () => new Promise((resolve) => setTimeout(resolve, 0));

function usageHarness(
	session: UsageSession,
	fetchers: {
		codex?: ConstructorParameters<typeof UsageController>[2];
		openCodeGo?: ConstructorParameters<typeof UsageController>[3];
	} = {},
) {
	let rendered: AppUsage | undefined;
	const runtime = agentSessionRuntimeStub({ session });
	const controller = new UsageController(
		() => runtime,
		{
			setUsage: (usage: AppUsage) => {
				rendered = usage;
			},
		},
		fetchers.codex ?? (async () => undefined),
		fetchers.openCodeGo ?? (async () => undefined),
	);
	return { controller, rendered: () => rendered };
}

test("keeps cached Codex usage through failed refreshes and model switches", async () => {
	let failure: "empty" | "timeout" | undefined;
	let usedPercent = 22;
	const codexModel = { provider: "openai-codex", id: "gpt-5" };
	let model = codexModel;
	const session = {
		get model() {
			return model;
		},
		...sessionStats,
	};
	const warning = spyOn(console, "warn").mockImplementation(() => {});
	const { controller, rendered } = usageHarness(session, {
		codex: async () => {
			if (failure === "timeout")
				throw new DOMException("The operation was aborted.", "AbortError");
			if (failure === "empty") return undefined;
			return { primary: { usedPercent, windowSeconds: 604_800 } };
		},
	});
	onTestFinished(() => {
		warning.mockRestore();
		controller.dispose();
	});

	controller.refresh();
	await flush();
	assertEquals(rendered()?.limits, {
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
		await flush();
		assertEquals(rendered()?.limits?.windows[0]?.remainingPercent, 78);
	}
	assertEquals(
		warning.mock.calls.map(([message]) => message),
		["codex usage request timed out"],
	);
	failure = undefined;
	usedPercent = 23;
	controller.refresh(true);
	await flush();
	assertEquals(rendered()?.limits?.windows[0]?.remainingPercent, 77);

	model = { provider: "anthropic", id: "claude" };
	controller.suspend();
	controller.sync();
	assertEquals(rendered()?.limits, undefined);

	model = codexModel;
	controller.suspend();
	controller.sync();
	assertEquals(rendered()?.limits?.windows[0]?.remainingPercent, 77);
});

test("shows OpenCode Go usage and retains it after an unavailable refresh", async () => {
	let available = false;
	const model = { provider: "opencode-go", id: "kimi-k2.5" };
	const { controller, rendered } = usageHarness(
		{ model, ...sessionStats },
		{
			openCodeGo: async () =>
				available
					? {
							rolling: { usedPercent: 12 },
							weekly: { usedPercent: 8 },
							monthly: { usedPercent: 35 },
						}
					: undefined,
		},
	);

	controller.refresh();
	await flush();
	assertEquals(rendered()?.limits?.status, "unavailable");
	available = true;
	controller.refresh(true);
	await flush();
	assertEquals(rendered()?.limits, {
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
	await flush();
	assertEquals(rendered()?.limits?.windows[0]?.remainingPercent, 88);
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
