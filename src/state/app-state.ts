import { patchElements, patchSignals } from "../server/datastar.ts";
import { renderTopbar, renderTranscript } from "../ui/fragments.tsx";

export type AppMessage = {
	id: string;
	role: "user" | "assistant" | "system" | "tool";
	text: string;
	timestamp: Date;
	title?: string;
	meta?: string;
	state?: "running" | "success" | "error";
};

export type AppMessageOptions = Pick<AppMessage, "title" | "meta" | "state">;

export type AppModel = {
	id: string;
	provider: string;
	name: string;
	configured: boolean;
};

type StreamClient = {
	id: string;
	controller: ReadableStreamDefaultController<Uint8Array>;
};

const encoder = new TextEncoder();

export class AppState {
	private clients = new Map<string, StreamClient>();
	private messageSeq = 0;
	private activeAssistantId: string | undefined;
	messages: AppMessage[] = [];
	status = "Starting";
	models: AppModel[] = [];
	currentModel: string | undefined;

	createStream(signal: AbortSignal): ReadableStream<Uint8Array> {
		const id = crypto.randomUUID();
		return new ReadableStream({
			start: (controller) => {
				this.clients.set(id, { id, controller });
				this.sendTo(controller, this.renderPatch());
				this.sendTo(controller, patchSignals({ connected: true }));
				signal.addEventListener("abort", () => this.clients.delete(id), {
					once: true,
				});
			},
			cancel: () => {
				this.clients.delete(id);
			},
		});
	}

	appendMessage(
		role: AppMessage["role"],
		text: string,
		options: AppMessageOptions = {},
	): string {
		this.messageSeq += 1;
		const id = `m-${this.messageSeq}`;
		this.messages.push({ id, role, text, timestamp: new Date(), ...options });
		if (role === "assistant") {
			this.activeAssistantId = id;
		}
		this.broadcast();
		return id;
	}

	updateMessage(id: string, patch: Partial<Omit<AppMessage, "id">>): void {
		const message = this.messages.find((item) => item.id === id);
		if (!message) {
			return;
		}
		Object.assign(message, patch);
		this.broadcast();
	}

	appendAssistantDelta(delta: string): void {
		if (!this.activeAssistantId) {
			this.appendMessage("assistant", delta);
			return;
		}
		const message = this.messages.find((item) => item.id === this.activeAssistantId);
		if (!message) {
			this.appendMessage("assistant", delta);
			return;
		}
		message.text += delta;
		this.broadcast();
	}

	finishAssistant(): void {
		this.activeAssistantId = undefined;
		this.broadcast();
	}

	resetChat(): void {
		this.messages = [];
		this.activeAssistantId = undefined;
		this.broadcast();
	}

	setStatus(status: string): void {
		this.status = status;
		this.broadcast();
	}

	setModels(models: AppModel[], currentModel: string | undefined): void {
		this.models = models;
		this.currentModel = currentModel;
		this.broadcast();
	}

	setCurrentModel(currentModel: string | undefined): void {
		this.currentModel = currentModel;
		this.broadcast();
	}

	private renderPatch(): string {
		return patchElements(renderTopbar(this) + renderTranscript(this.messages));
	}

	private broadcast(): void {
		const payload = this.renderPatch();
		for (const client of this.clients.values()) {
			this.sendTo(client.controller, payload);
		}
	}

	private sendTo(
		controller: ReadableStreamDefaultController<Uint8Array>,
		chunk: string,
	): void {
		try {
			controller.enqueue(encoder.encode(chunk));
		} catch {
			// Client already disconnected.
		}
	}
}
