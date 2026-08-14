import type { AgentSessionRuntime } from "@earendil-works/pi-coding-agent";

import type { AppLlamaDialog, AppLlamaModel, AppStore } from "../state/app-store.ts";
import { errorMessage } from "../utils/errors.ts";
import {
	LlamaClient,
	llamaLoadProgress,
	type LlamaModelInfo,
	llamaProviderId,
} from "./llama-client.ts";

const pollIntervalMs = 500;
type LlamaRuntime = {
	services: {
		modelRuntime: Pick<
			AgentSessionRuntime["services"]["modelRuntime"],
			"getAuth" | "refresh"
		>;
	};
};
type LlamaOperation = {
	abortController: AbortController;
	modelId: string;
	load: boolean;
	client?: LlamaClient;
};

export class LlamaController {
	private operation: LlamaOperation | undefined;

	constructor(
		private readonly getRuntime: () => LlamaRuntime,
		private readonly state: AppStore,
		private readonly onModelsChanged: () => void,
	) {}

	open(): void {
		this.cancelOperation();
		this.state.setLlamaDialog({ models: [], status: "Loading models…" });
		void this.refreshDialog();
	}

	close(): void {
		this.cancelOperation();
		this.state.setLlamaDialog(undefined);
	}

	toggle(modelId: string): boolean {
		const dialog = this.state.llamaDialog;
		const model = dialog?.models.find((candidate) => candidate.id === modelId);
		if (!dialog || !model || this.operation) return false;
		const operation: LlamaOperation = {
			abortController: new AbortController(),
			modelId,
			load: !modelIsLoaded(model.status),
		};
		this.operation = operation;
		this.state.setLlamaDialog({
			...dialog,
			busyModel: modelId,
			status: operation.load ? `Loading ${modelId}…` : `Unloading ${modelId}…`,
			error: undefined,
		});
		void this.run(operation);
		return true;
	}

	dispose(): void {
		this.cancelOperation();
	}

	private async refreshDialog(): Promise<void> {
		try {
			const client = await this.client();
			if (!this.state.llamaDialog) return;
			const models = await client.list(AbortSignal.timeout(15_000));
			if (!this.state.llamaDialog) return;
			this.state.setLlamaDialog({
				models: models.map(toAppModel),
				serverUrl: client.serverUrl,
			});
		} catch (error) {
			if (!this.state.llamaDialog) return;
			this.state.setLlamaDialog({ models: [], error: errorMessage(error) });
		}
	}

	private async run(operation: LlamaOperation): Promise<void> {
		const { modelId, load, abortController } = operation;
		try {
			const client = await this.client();
			operation.client = client;
			if (load) this.watchProgress(operation);
			await client.setLoaded(modelId, load, abortController.signal);
			const catalog = await this.waitForStatus(operation);
			await this.getRuntime().services.modelRuntime.refresh({
				providers: [llamaProviderId],
				signal: abortController.signal,
			});
			if (this.operation !== operation || !this.state.llamaDialog) return;
			this.operation = undefined;
			abortController.abort();
			this.state.setLlamaDialog({
				models: catalog.map(toAppModel),
				serverUrl: client.serverUrl,
				status: load ? `Loaded ${modelId}.` : `Unloaded ${modelId}.`,
			});
			this.onModelsChanged();
		} catch (error) {
			if (this.operation !== operation || abortController.signal.aborted) return;
			this.operation = undefined;
			this.updateDialog({
				busyModel: undefined,
				progress: undefined,
				status: undefined,
				error: errorMessage(error),
			});
		}
	}

	private watchProgress(operation: LlamaOperation): void {
		const client = operation.client;
		if (!client) return;
		void client
			.watch((event) => {
				if (event.model !== operation.modelId || this.operation !== operation)
					return;
				const progress = llamaLoadProgress(event);
				if (progress) this.updateDialog({ progress });
			}, operation.abortController.signal)
			.catch(() => {});
	}

	private async waitForStatus(operation: LlamaOperation): Promise<LlamaModelInfo[]> {
		const client = operation.client;
		if (!client) throw new Error("llama.cpp client unavailable");
		while (true) {
			await sleep(pollIntervalMs, operation.abortController.signal);
			const catalog = await client.list(operation.abortController.signal);
			const model = catalog.find((candidate) => candidate.id === operation.modelId);
			const reachedTarget = operation.load
				? model?.status.value === "loaded"
				: model?.status.value === "unloaded";
			if (reachedTarget) return catalog;
			if (model?.status.failed) {
				throw new Error(
					model.status.exit_code === undefined
						? `Failed to ${operation.load ? "load" : "unload"} ${operation.modelId}`
						: `llama.cpp exited with code ${model.status.exit_code}`,
				);
			}
		}
	}

	private async client(): Promise<LlamaClient> {
		const result =
			await this.getRuntime().services.modelRuntime.getAuth(llamaProviderId);
		if (!result) throw configurationError();
		const serverUrl = result.env?.LLAMA_BASE_URL ?? result.auth.baseUrl;
		if (!serverUrl) throw configurationError();
		return new LlamaClient(serverUrl, result.auth.apiKey);
	}

	private updateDialog(patch: Partial<AppLlamaDialog>): void {
		const dialog = this.state.llamaDialog;
		if (dialog) this.state.setLlamaDialog({ ...dialog, ...patch });
	}

	private cancelOperation(): void {
		const operation = this.operation;
		if (!operation) return;
		this.operation = undefined;
		operation.abortController.abort();
		if (operation.load && operation.client) {
			void operation.client
				.setLoaded(operation.modelId, false, AbortSignal.timeout(15_000))
				.catch(() => {});
		}
	}
}

function configurationError(): Error {
	return new Error("Configure llama.cpp with /login llama.cpp first.");
}

function modelIsLoaded(status: string): boolean {
	return status === "loaded" || status === "sleeping";
}

function toAppModel(model: LlamaModelInfo): AppLlamaModel {
	return { id: model.id, status: model.status.value };
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
	return new Promise((resolve, reject) => {
		if (signal.aborted) {
			reject(signal.reason);
			return;
		}
		const abort = () => {
			clearTimeout(timeout);
			reject(signal.reason);
		};
		const timeout = setTimeout(() => {
			signal.removeEventListener("abort", abort);
			resolve();
		}, ms);
		signal.addEventListener("abort", abort, { once: true });
	});
}
