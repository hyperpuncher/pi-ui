import type { AgentSessionRuntime } from "@earendil-works/pi-coding-agent";
import { assertEquals } from "@std/assert";

import { AppStore } from "../state/app-store.ts";
import { AuthController } from "./auth-controller.ts";

function nextTurn(): Promise<void> {
	return new Promise((resolve) => setTimeout(resolve, 0));
}

Deno.test("provider-owned API key login can request multiple fields", async () => {
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
	const runtime = {
		services: { modelRuntime },
	} as unknown as AgentSessionRuntime;
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
	assertEquals(state.authDialog?.prompt, {
		message: "Enter API key",
		placeholder: undefined,
		secret: true,
		options: undefined,
	});

	assertEquals(controller.submitInput("secret"), true);
	await nextTurn();
	assertEquals(state.authDialog?.prompt?.message, "Enter account ID");
	assertEquals(state.authDialog?.prompt?.secret, false);

	assertEquals(controller.submitInput("account"), true);
	await nextTurn();
	assertEquals(submitted, ["secret", "account"]);
	assertEquals(changed, 1);
	assertEquals(state.authDialog?.phase, "result");
});
