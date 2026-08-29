import { test } from "bun:test";

import { assertEquals, assertStrictEquals } from "#testing/assertions";

import { AppStore } from "../state/app-store.ts";
import { ModelController } from "./model-controller.ts";
import { agentSessionRuntimeStub } from "./test-fixtures.ts";

test("ModelController persists explicit and cycled model selections", async () => {
	const model = { id: "kimi-k2.6", provider: "opencode-go" };
	const persistence: Array<boolean | undefined> = [];
	const defaults: Array<{ provider: string; id: string }> = [];
	let flushes = 0;
	let changes = 0;
	const runtime = agentSessionRuntimeStub({
		session: {
			setModel: (selected: typeof model, options?: { persist?: boolean }) => {
				assertStrictEquals(selected, model);
				persistence.push(options?.persist);
				return Promise.resolve();
			},
			cycleModel: (
				_direction: "forward" | "backward",
				options?: { persist?: boolean },
			) => {
				persistence.push(options?.persist);
				return Promise.resolve({ model });
			},
		},
		services: {
			modelRuntime: {
				getModel: (provider: string, id: string) =>
					provider === model.provider && id === model.id ? model : undefined,
			},
			settingsManager: {
				setDefaultModelAndProvider: (provider: string, id: string) => {
					defaults.push({ provider, id });
				},
				flush: () => {
					flushes += 1;
					return Promise.resolve();
				},
			},
		},
	});
	const controller = new ModelController(
		() => runtime,
		new AppStore(),
		() => {
			changes += 1;
		},
	);

	assertEquals(await controller.set("opencode-go/kimi-k2.6"), true);
	assertEquals(await controller.cycle(), true);
	assertEquals(persistence, [false, true]);
	assertEquals(defaults, [{ provider: "opencode-go", id: "kimi-k2.6" }]);
	assertEquals(flushes, 2);
	assertEquals(changes, 2);
});
