import type {
	ApiKeyCredential,
	AuthContext,
	AuthResult,
	Model,
	Provider,
	ProviderStreamOptions,
	RefreshModelsContext,
} from "@earendil-works/pi-ai";
import { stream, streamSimple } from "@earendil-works/pi-ai/compat";
import type { ExtensionAPI, InlineExtension } from "@earendil-works/pi-coding-agent";

import {
	LlamaClient,
	type LlamaModelInfo,
	llamaInferenceUrl,
	llamaProviderId,
	normalizeLlamaServerUrl,
} from "./llama-client.ts";

const defaultServerUrl = "http://127.0.0.1:8080";

function credentialServerUrl(
	credential: ApiKeyCredential | undefined,
): string | undefined {
	const value = credential?.env?.LLAMA_BASE_URL;
	return value?.trim() ? normalizeLlamaServerUrl(value) : undefined;
}

async function resolveServerUrl(
	ctx: AuthContext,
	credential: ApiKeyCredential | undefined,
): Promise<string | undefined> {
	const configured =
		credentialServerUrl(credential) ?? (await ctx.env("LLAMA_BASE_URL"))?.trim();
	return configured ? normalizeLlamaServerUrl(configured) : undefined;
}

function toPiModel(
	model: LlamaModelInfo,
	serverUrl: string,
): Model<"openai-completions"> {
	const reportedContextWindow = model.meta?.n_ctx ?? model.meta?.n_ctx_train;
	const contextWindow =
		reportedContextWindow && reportedContextWindow > 0
			? reportedContextWindow
			: 128000;
	return {
		id: model.id,
		name: model.id,
		api: "openai-completions",
		provider: llamaProviderId,
		baseUrl: llamaInferenceUrl(serverUrl),
		reasoning: false,
		input: model.architecture?.input_modalities?.includes("image")
			? ["text", "image"]
			: ["text"],
		cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
		contextWindow,
		maxTokens: contextWindow,
		compat: {
			supportsStore: false,
			supportsDeveloperRole: false,
			supportsReasoningEffort: false,
			supportsUsageInStreaming: true,
			supportsStrictMode: false,
			maxTokensField: "max_tokens",
		},
	};
}

function createProvider(): Provider<"openai-completions"> {
	let models: readonly Model<"openai-completions">[] = [];
	return {
		id: llamaProviderId,
		name: "llama.cpp",
		baseUrl: llamaInferenceUrl(defaultServerUrl),
		auth: {
			apiKey: {
				name: "llama.cpp server",
				login: async (interaction): Promise<ApiKeyCredential> => {
					const environmentUrl = process.env.LLAMA_BASE_URL;
					const enteredUrl = await interaction.prompt({
						type: "text",
						message: "llama.cpp server URL",
						placeholder: environmentUrl ?? defaultServerUrl,
					});
					const serverUrl = normalizeLlamaServerUrl(
						enteredUrl.trim() || environmentUrl || defaultServerUrl,
					);
					const apiKey = (
						await interaction.prompt({
							type: "secret",
							message: "API key (optional)",
						})
					).trim();
					await new LlamaClient(serverUrl, apiKey || undefined).list(
						interaction.signal,
					);
					return {
						type: "api_key",
						key: apiKey || undefined,
						env: { LLAMA_BASE_URL: serverUrl },
					};
				},
				check: async ({ ctx, credential }) => {
					const serverUrl = await resolveServerUrl(ctx, credential);
					return serverUrl
						? {
								type: "api_key",
								source: credential
									? "stored credential"
									: "LLAMA_BASE_URL",
							}
						: undefined;
				},
				resolve: async ({ ctx, credential }): Promise<AuthResult | undefined> => {
					const serverUrl = await resolveServerUrl(ctx, credential);
					if (!serverUrl) return undefined;
					const apiKey =
						credential?.key ?? (await ctx.env("LLAMA_API_KEY")) ?? "local";
					return {
						auth: { apiKey, baseUrl: llamaInferenceUrl(serverUrl) },
						env: { ...credential?.env, LLAMA_BASE_URL: serverUrl },
						source: credential ? "stored credential" : "LLAMA_BASE_URL",
					};
				},
			},
		},
		getModels: () => models,
		refreshModels: async (context: RefreshModelsContext): Promise<void> => {
			if (context.stored) {
				const restored = context.stored.models.filter(
					(model): model is Model<"openai-completions"> =>
						model.provider === llamaProviderId &&
						model.api === "openai-completions",
				);
				if (!(await context.publish({ update: () => (models = restored) })))
					return;
			}
			if (
				!context.allowNetwork ||
				context.signal.aborted ||
				context.credential?.type !== "api_key"
			)
				return;
			const serverUrl = credentialServerUrl(context.credential);
			if (!serverUrl) return;
			const catalog = await new LlamaClient(serverUrl, context.credential.key).list(
				context.signal,
			);
			if (context.signal.aborted) return;
			const refreshed = catalog
				.filter((model) => model.status.value === "loaded")
				.map((model) => toPiModel(model, serverUrl));
			await context.publish({
				persist: { models: refreshed, checkedAt: Date.now() },
				update: () => (models = refreshed),
			});
		},
		stream: (model, context, options) =>
			// SAFETY: The llama.cpp provider uses the standard OpenAI-compatible stream options.
			stream(model, context, options as ProviderStreamOptions | undefined),
		streamSimple: (model, context, options) => streamSimple(model, context, options),
	};
}

function registerLlamaProvider(api: ExtensionAPI): void {
	api.registerProvider(createProvider());
}

export const llamaProviderExtension: InlineExtension = {
	name: llamaProviderId,
	factory: registerLlamaProvider,
	hidden: true,
};
