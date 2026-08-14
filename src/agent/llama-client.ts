import Type, { type Static } from "typebox";
import { Compile } from "typebox/compile";

export const llamaProviderId = "llama.cpp";

const modelSchema = Type.Object({
	id: Type.String(),
	status: Type.Object({
		value: Type.String(),
		failed: Type.Optional(Type.Boolean()),
		exit_code: Type.Optional(Type.Number()),
	}),
	architecture: Type.Optional(
		Type.Object({ input_modalities: Type.Optional(Type.Array(Type.String())) }),
	),
	meta: Type.Optional(
		Type.Object({
			n_ctx: Type.Optional(Type.Number()),
			n_ctx_train: Type.Optional(Type.Number()),
		}),
	),
});
const catalogSchema = Type.Object({ data: Type.Array(modelSchema) });
const eventSchema = Type.Object({
	model: Type.String(),
	event: Type.String(),
	data: Type.Optional(Type.Unknown()),
});
const loadProgressSchema = Type.Object({
	progress: Type.Object({
		stages: Type.Optional(Type.Array(Type.String())),
		current: Type.Optional(Type.String()),
		stage: Type.Optional(Type.String()),
		value: Type.Optional(Type.Number()),
	}),
});
const catalogValidator = Compile(catalogSchema);
const eventValidator = Compile(eventSchema);
const loadProgressValidator = Compile(loadProgressSchema);

export type LlamaModelInfo = Static<typeof modelSchema>;
export type LlamaModelEvent = Static<typeof eventSchema>;
export type LlamaLoadProgress = { label: string; ratio?: number };

export class LlamaClient {
	readonly serverUrl: string;

	constructor(
		serverUrl: string,
		private readonly apiKey?: string,
	) {
		this.serverUrl = normalizeLlamaServerUrl(serverUrl);
	}

	async list(signal: AbortSignal): Promise<LlamaModelInfo[]> {
		const response = await this.request("/models", { signal });
		if (!response.ok) throw new Error(`llama.cpp returned HTTP ${response.status}`);
		const payload: unknown = await response.json();
		if (!catalogValidator.Check(payload)) {
			throw new Error("Server is not running in llama.cpp router mode");
		}
		return payload.data;
	}

	async setLoaded(model: string, load: boolean, signal: AbortSignal): Promise<void> {
		const response = await this.request(load ? "/models/load" : "/models/unload", {
			method: "POST",
			body: JSON.stringify({ model }),
			signal,
		});
		if (!response.ok) throw new Error(`llama.cpp returned HTTP ${response.status}`);
	}

	async watch(
		onEvent: (event: LlamaModelEvent) => void,
		signal: AbortSignal,
	): Promise<void> {
		const response = await this.request("/models/sse", { signal }, false);
		if (!response.ok || !response.body) {
			throw new Error(`llama.cpp SSE returned HTTP ${response.status}`);
		}
		const reader = response.body.getReader();
		const decoder = new TextDecoder();
		let buffer = "";
		while (true) {
			const chunk = await reader.read();
			if (chunk.done) return;
			buffer += decoder
				.decode(chunk.value, { stream: true })
				.replaceAll("\r\n", "\n");
			let boundary = buffer.indexOf("\n\n");
			while (boundary >= 0) {
				parseEventFrame(buffer.slice(0, boundary), onEvent);
				buffer = buffer.slice(boundary + 2);
				boundary = buffer.indexOf("\n\n");
			}
		}
	}

	private async request(
		path: string,
		init: RequestInit,
		timeout = true,
	): Promise<Response> {
		const headers = new Headers(init.headers);
		if (init.body !== undefined) headers.set("Content-Type", "application/json");
		if (this.apiKey) headers.set("Authorization", `Bearer ${this.apiKey}`);
		const signal = timeout
			? init.signal
				? AbortSignal.any([init.signal, AbortSignal.timeout(15_000)])
				: AbortSignal.timeout(15_000)
			: init.signal;
		return await fetch(`${this.serverUrl}${path}`, { ...init, headers, signal });
	}
}

export function normalizeLlamaServerUrl(value: string): string {
	const url = new URL(value.trim());
	if (url.protocol !== "http:" && url.protocol !== "https:") {
		throw new Error("Server URL must use http or https");
	}
	url.hash = "";
	url.search = "";
	url.pathname = url.pathname.replace(/\/+$/u, "").replace(/\/v1$/u, "") || "/";
	return url.toString().replace(/\/$/u, "");
}

export function llamaInferenceUrl(serverUrl: string): string {
	return `${normalizeLlamaServerUrl(serverUrl)}/v1`;
}

export function llamaLoadProgress(event: LlamaModelEvent): LlamaLoadProgress | undefined {
	if (!loadProgressValidator.Check(event.data)) return undefined;
	const progress = event.data.progress;
	const stage = progress.current ?? progress.stage;
	const stages = progress.stages ?? [];
	const stageRatio =
		progress.value === undefined
			? undefined
			: Math.max(0, Math.min(1, progress.value));
	let ratio = stageRatio;
	if (stage && stages.length > 0) {
		const index = stages.indexOf(stage);
		if (index >= 0) ratio = (index + (stageRatio ?? 0)) / stages.length;
	}
	return {
		label: stage ? `Loading ${stage.replaceAll("_", " ")}` : "Loading model",
		ratio,
	};
}

function parseEventFrame(frame: string, onEvent: (event: LlamaModelEvent) => void): void {
	const data = frame
		.split("\n")
		.filter((line) => line.startsWith("data:"))
		.map((line) => line.slice(5).trimStart())
		.join("\n");
	if (!data) return;
	try {
		const event: unknown = JSON.parse(data);
		if (eventValidator.Check(event)) onEvent(event);
	} catch {
		// Catalog polling remains authoritative when an event is malformed.
	}
}
