import { test } from "bun:test";

import { AuthController } from "#src/agent/auth-controller.ts";
import { AppStore } from "#src/state/app-store.ts";
import { assertEquals } from "#testing/assertions";

import { agentSessionRuntimeStub } from "./test-fixtures.ts";

function nextTurn(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

test("OAuth login preserves account metadata and supplies a stable device ID", async () => {
	let loginDeviceId: string | undefined;
	const providers = [
		{
			id: "openai",
			name: "OpenAI",
			auth: { oauth: { name: "Sign in with ChatGPT", isSubscription: true } },
		},
		{
			id: "radius",
			name: "Radius",
			auth: { oauth: { name: "Radius", isSubscription: false } },
		},
	];
	const modelRuntime = {
		getProviders: () => providers,
		getProvider: (id: string) => providers.find((provider) => provider.id === id),
		login: async (
			_providerId: string,
			_type: string,
			_interaction: unknown,
			options: { getDeviceId?: () => string },
		) => {
			loginDeviceId = options.getDeviceId?.();
		},
	};
	const runtime = agentSessionRuntimeStub({
		services: {
			modelRuntime,
			settingsManager: {
				getOrCreateDeviceId: () => "0199a00a-1234-7000-8000-123456789abc",
			},
		},
	});
	const state = new AppStore();
	const controller = new AuthController(
		() => runtime,
		state,
		() => {},
	);

	controller.openLogin();
	assertEquals(
		state.authDialog?.providers.map(({ id, subscription }) => ({
			id,
			subscription,
		})),
		[
			{ id: "openai", subscription: true },
			{ id: "radius", subscription: false },
		],
	);
	assertEquals(controller.startLogin("openai", "oauth"), true);
	await nextTurn();
	assertEquals(loginDeviceId, "0199a00a-1234-7000-8000-123456789abc");
});

test("provider-owned API key login can request multiple fields and accept empty values", async () => {
	const submitted: string[] = [];
	const provider = {
		id: "custom-cloud",
		name: "Custom Cloud",
		auth: {
			apiKey: {
				name: "Custom Cloud credentials",
				login: async (interaction: {
					prompt(prompt: {
						type: "secret" | "text";
						message: string;
					}): Promise<string>;
				}) => {
					submitted.push(
						await interaction.prompt({
							type: "secret",
							message: "Enter API key",
						}),
					);
					submitted.push(
						await interaction.prompt({
							type: "text",
							message: "Enter account ID",
						}),
					);
					return { type: "api_key" as const, key: submitted[0] };
				},
			},
		},
	};
	const modelRuntime = {
		getProviders: () => [provider],
		getProvider: () => provider,
		login: async (
			_providerId: string,
			_type: string,
			interaction: Parameters<NonNullable<typeof provider.auth.apiKey.login>>[0],
		) => await provider.auth.apiKey.login(interaction),
	};
	const runtime = agentSessionRuntimeStub({
		services: { modelRuntime },
	});
	const state = new AppStore();
	let changed = 0;
	const controller = new AuthController(
		() => runtime,
		state,
		() => changed++,
	);

	controller.openLogin();
	assertEquals(state.authDialog?.providers, [
		{
			id: "custom-cloud",
			name: "Custom Cloud",
			authType: "api_key",
		},
	]);
	assertEquals(controller.startLogin("custom-cloud", "api_key"), true);
	const firstPromptId = state.authDialog!.prompt!.id;
	assertEquals(state.authDialog?.prompt, {
		id: firstPromptId,
		message: "Enter API key",
		placeholder: undefined,
		secret: true,
		options: undefined,
	});

	assertEquals(controller.submitInput("secret"), true);
	await nextTurn();
	assertEquals(state.authDialog?.prompt?.message, "Enter account ID");
	assertEquals(state.authDialog?.prompt?.secret, false);
	assertEquals(state.authDialog?.prompt?.id !== firstPromptId, true);

	assertEquals(controller.submitInput(""), true);
	await nextTurn();
	assertEquals(submitted, ["secret", ""]);
	assertEquals(changed, 1);
	assertEquals(state.authDialog?.phase, "result");
});
