import { test } from "bun:test";

import { assertEquals } from "#testing/assertions";

import type { AppUsage } from "../state/app-store.ts";
import { agentSessionRuntimeStub } from "./test-fixtures.ts";
import {
	cumulativeCacheHitPercent,
	ProviderUsagePool,
	UsageController,
} from "./usage-controller.ts";

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
		// Each harness gets its own pool by default, matching a lone `UsageController`'s prior
		// per-instance state exactly; the dedup/sharing tests below pass one explicitly instead.
		pool?: ProviderUsagePool;
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
		fetchers.pool ?? new ProviderUsagePool(),
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
	const { controller, rendered } = usageHarness(session, {
		codex: async () => {
			if (failure === "timeout")
				throw new DOMException("The operation was aborted.", "AbortError");
			if (failure === "empty") return undefined;
			return { primary: { usedPercent, windowSeconds: 604_800 } };
		},
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
	controller.dispose();
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

test("a freshly created controller reuses another controller's still-fresh cached quota via a shared pool (R2-C)", async () => {
	const model = { provider: "openai-codex", id: "gpt-5" };
	const pool = new ProviderUsagePool();
	let fetchCount = 0;
	const codex = async () => {
		fetchCount += 1;
		return { primary: { usedPercent: 40, windowSeconds: 604_800 } };
	};

	const first = usageHarness({ model, ...sessionStats }, { codex, pool });
	first.controller.refresh();
	await flush();
	assertEquals(first.rendered()?.limits?.windows[0]?.usedPercent, 40);
	assertEquals(fetchCount, 1);
	first.controller.dispose();

	// A second, independently-constructed controller sharing the same pool (standing in for a
	// runtime host recreated after a failure) must see the cached quota immediately — not a
	// blank "loading" state — and must not issue a second fetch within the TTL window.
	const second = usageHarness({ model, ...sessionStats }, { codex, pool });
	second.controller.sync();
	assertEquals(second.rendered()?.limits?.windows[0]?.usedPercent, 40);
	second.controller.refresh();
	await flush();
	assertEquals(fetchCount, 1);
	second.controller.dispose();
});

test("two controllers sharing a pool join one in-flight request instead of fetching twice", async () => {
	const model = { provider: "opencode-go", id: "kimi-k2.5" };
	const pool = new ProviderUsagePool();
	let fetchCount = 0;
	let resolveFetch: (() => void) | undefined;
	const openCodeGo = async () => {
		fetchCount += 1;
		await new Promise<void>((resolveWait) => {
			resolveFetch = resolveWait;
		});
		return {
			rolling: { usedPercent: 5 },
			weekly: { usedPercent: 5 },
			monthly: { usedPercent: 5 },
		};
	};

	const first = usageHarness({ model, ...sessionStats }, { openCodeGo, pool });
	const second = usageHarness({ model, ...sessionStats }, { openCodeGo, pool });
	first.controller.refresh();
	second.controller.refresh();
	await flush();
	assertEquals(fetchCount, 1);

	resolveFetch?.();
	await flush();
	await flush();
	assertEquals(first.rendered()?.limits?.windows[0]?.usedPercent, 5);
	assertEquals(second.rendered()?.limits?.windows[0]?.usedPercent, 5);
	first.controller.dispose();
	second.controller.dispose();
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
