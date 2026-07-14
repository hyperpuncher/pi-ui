import type { AgentSessionRuntime } from "@earendil-works/pi-coding-agent";
import { assertEquals } from "@std/assert";

import type { AppStore, AppUsage } from "../state/app-store.ts";
import { UsageController } from "./usage-controller.ts";

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
	assertEquals(rendered?.codexText, "1w 78% ?");

	model = { provider: "anthropic", id: "claude" };
	controller.suspend();
	controller.sync();
	assertEquals(rendered?.codexText, undefined);

	model = codexModel;
	controller.suspend();
	controller.sync();
	assertEquals(rendered?.codexText, "1w 78% ?");
	controller.dispose();
});
