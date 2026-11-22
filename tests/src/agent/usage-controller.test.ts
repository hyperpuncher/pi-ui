import { onTestFinished, spyOn, test } from "bun:test";

import { createEventBus } from "@earendil-works/pi-coding-agent";

import { extensionQuotaBuses } from "#src/agent/extension-quota.ts";
import {
	cumulativeCacheHitPercent,
	UsageController,
} from "#src/agent/usage-controller.ts";
import type { AppUsage } from "#src/state/app-store.ts";
import { assertEquals } from "#testing/assertions";
import { agentSessionRuntimeStub } from "#tests/src/agent/test-fixtures.ts";

const sessionStats = {
	getSessionStats: () => ({
		cost: 0,
		tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
		contextUsage: null,
	}),
	sessionManager: { getEntries: () => [], getBranch: () => [] },
};

type UsageSession = {
	model?: { provider?: string; id?: string };
	messages?: readonly {
		role: string;
		diagnostics?: readonly { type: string; details?: unknown }[];
	}[];
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
	sessionManager: { getEntries: () => unknown[]; getBranch: () => { type: string }[] };
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
	let now = Date.now();
	const resetsAt = now / 1_000 + 90 * 60;
	const clock = spyOn(Date, "now").mockImplementation(() => now);
	const codexModel = { provider: "openai-codex", id: "gpt-5" };
	let model = codexModel;
	const session = {
		get model() {
			return model;
		},
		messages: [],
		...sessionStats,
	};
	const warning = spyOn(console, "warn").mockImplementation(() => {});
	const { controller, rendered } = usageHarness(session, {
		codex: async () => {
			if (failure === "timeout")
				throw new DOMException("The operation was aborted.", "AbortError");
			if (failure === "empty") return undefined;
			return { primary: { usedPercent, windowSeconds: 604_800, resetsAt } };
		},
	});
	onTestFinished(() => {
		clock.mockRestore();
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
				resetText: "1.5h",
			},
		],
	});

	now += 60 * 60_000;
	for (const outcome of ["timeout", "empty"] as const) {
		failure = outcome;
		controller.refresh(true);
		await flush();
		assertEquals(rendered()?.limits?.windows[0]?.remainingPercent, 78);
		assertEquals(rendered()?.limits?.windows[0]?.resetText, "30m");
		assertEquals(rendered()?.limits?.status, "stale (refresh unavailable)");
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
	assertEquals(rendered()?.limits?.status, undefined);

	model = { provider: "openai", id: "gpt-5" };
	controller.suspend();
	controller.sync();
	assertEquals(rendered()?.limits?.label, "Codex limits");
	assertEquals(rendered()?.limits?.windows[0]?.remainingPercent, 77);
	usedPercent = 24;
	controller.refresh(true);
	await flush();
	assertEquals(rendered()?.limits?.windows[0]?.remainingPercent, 76);

	model = { provider: "anthropic", id: "claude" };
	controller.suspend();
	controller.sync();
	assertEquals(rendered()?.limits, undefined);

	model = codexModel;
	controller.suspend();
	controller.sync();
	assertEquals(rendered()?.limits?.windows[0]?.remainingPercent, 76);
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
	assertEquals(rendered()?.limits?.status, "stale (refresh unavailable)");
	controller.dispose();
});

test("refreshes live quota across chats and clears it on failure", async () => {
	let utilization: number | undefined = 0.24;
	const makeRuntime = () => {
		const runtime = agentSessionRuntimeStub({
			session: {
				model: { provider: "example", id: "example-model" },
				resourceLoader: {},
				messages: [],
				...sessionStats,
			},
		});
		const bus = createEventBus();
		extensionQuotaBuses.set(runtime.session.resourceLoader, bus);
		bus.on("pi-ui:quota:example", (data) => {
			const { respond } = data as { respond: (pending: Promise<unknown>) => void };
			const details =
				utilization === undefined
					? undefined
					: { unifiedWindows: { five_hour: { utilization } } };
			respond(Promise.resolve(details));
		});
		return runtime;
	};
	const older = makeRuntime();
	let runtime = makeRuntime();
	let rendered: AppUsage | undefined;
	const controller = new UsageController(() => runtime, {
		setUsage: (usage) => {
			rendered = usage;
		},
	});
	onTestFinished(() => controller.dispose());

	controller.refresh();
	await flush();
	assertEquals(rendered?.limits?.windows[0]?.usedPercent, 24);

	utilization = 0.37;
	controller.suspend();
	runtime = older;
	controller.refresh();
	await flush();
	assertEquals(rendered?.limits?.windows[0]?.usedPercent, 37);

	utilization = undefined;
	controller.refresh(true);
	await flush();
	assertEquals(rendered?.limits?.status, "unavailable");
	assertEquals(rendered?.limits?.windows, []);
});

test("shows Claude limits from the session rate-limit diagnostic", () => {
	const resetAt = Math.floor((Date.now() + 90 * 60_000) / 1_000);
	const model = { provider: "claude-code", id: "claude-haiku-5-5" };
	const messages = [
		{
			role: "assistant",
			diagnostics: [
				{
					type: "claude-code.rate-limit",
					details: {
						status: "allowed",
						isUsingOverage: false,
						unifiedWindows: {
							five_hour: { utilization: 0.42, resetsAt: resetAt },
						},
					},
				},
			],
		},
	];
	const { controller, rendered } = usageHarness({
		model,
		messages,
		...sessionStats,
	});

	controller.sync();
	assertEquals(rendered()?.limits?.label, "Claude limits");
	assertEquals(
		rendered()?.limits?.windows.map((window) => [
			window.label,
			window.remainingPercent,
		]),
		[["5 hours", 58]],
	);
	controller.dispose();
});

test("shows limits from an extension without registering its provider", () => {
	const { controller, rendered } = usageHarness({
		model: { provider: "custom", id: "example" },
		messages: [
			{
				role: "assistant",
				diagnostics: [
					{
						type: "custom.rate-limit",
						details: {
							label: "Custom quota",
							status: "rate limited",
							unifiedWindows: { model_quota: { utilization: 1 } },
						},
					},
				],
			},
		],
		...sessionStats,
	});

	controller.refresh();
	assertEquals(rendered()?.limits, {
		label: "Custom quota",
		status: "rate limited",
		windows: [
			{
				label: "model quota",
				usedPercent: 100,
				remainingPercent: 0,
				resetText: "?",
			},
		],
	});
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

test("counts compactions on the active session branch", () => {
	const { controller, rendered } = usageHarness({
		...sessionStats,
		sessionManager: {
			getEntries: () => [
				{ type: "compaction" },
				{ type: "compaction" },
				{ type: "compaction" },
			],
			getBranch: () => [
				{ type: "message" },
				{ type: "compaction" },
				{ type: "message" },
				{ type: "compaction" },
			],
		},
	});

	controller.sync();
	assertEquals(rendered()?.compactionCount, 2);
	controller.dispose();
});
