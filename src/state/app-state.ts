import type { DatastarStream } from "../server/datastar.ts";
import { datastarStream } from "../server/datastar.ts";
import { renderModelPicker, renderTopbar, renderTranscript } from "../ui/fragments.tsx";
import { renderMarkdownFinal, renderMarkdownStreaming } from "../ui/markdown.ts";

export type AppMessage = {
	id: string;
	role: "user" | "assistant" | "system" | "tool";
	text: string;
	timestamp: Date;
	title?: string;
	meta?: string;
	state?: "running" | "success" | "error";
	renderedHtml?: string;
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
	stream: DatastarStream;
};

export class AppState {
	private clients = new Map<string, StreamClient>();
	private messageSeq = 0;
	private activeAssistantId: string | undefined;
	messages: AppMessage[] = [];
	status = "Starting";
	models: AppModel[] = [];
	currentModel: string | undefined;

	createStream(signal: AbortSignal): Response {
		const id = crypto.randomUUID();
		return datastarStream(
			(stream) => {
				this.clients.set(id, { id, stream });
				this.patchClient(stream);
				stream.patchSignals(
					JSON.stringify({ connected: true, model: this.currentModel ?? "" }),
				);
				signal.addEventListener(
					"abort",
					() => {
						this.clients.delete(id);
						stream.close();
					},
					{ once: true },
				);
			},
			{
				keepalive: true,
				onAbort: () => {
					this.clients.delete(id);
				},
			},
		);
	}

	appendMessage(
		role: AppMessage["role"],
		text: string,
		options: AppMessageOptions = {},
	): string {
		this.messageSeq += 1;
		const id = `m-${this.messageSeq}`;
		this.messages.push({
			id,
			role,
			text,
			timestamp: new Date(),
			...options,
			renderedHtml:
				role === "assistant" && text.trim()
					? renderMarkdownStreaming(text)
					: undefined,
		});
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
		message.renderedHtml = renderMarkdownStreaming(message.text);
		this.broadcast();
	}

	finishAssistant(): void {
		const id = this.activeAssistantId;
		this.activeAssistantId = undefined;
		this.broadcast();
		if (id) {
			void this.renderAssistantMarkdown(id);
		}
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

	private async renderAssistantMarkdown(id: string): Promise<void> {
		const message = this.messages.find((item) => item.id === id);
		if (!message || message.role !== "assistant" || !message.text.trim()) {
			return;
		}

		const text = message.text;
		const renderedHtml = await renderMarkdownFinal(text);
		const current = this.messages.find((item) => item.id === id);
		if (!current || current.text !== text) {
			return;
		}

		current.renderedHtml = renderedHtml;
		this.broadcast();
	}

	private renderElements(): string {
		return (
			renderTopbar(this) + renderTranscript(this.messages) + renderModelPicker(this)
		);
	}

	private patchClient(stream: DatastarStream): void {
		try {
			stream.patchElements(this.renderElements());
			stream.patchSignals(JSON.stringify({ model: this.currentModel ?? "" }));
		} catch {
			// Client already disconnected.
		}
	}

	private broadcast(): void {
		for (const client of this.clients.values()) {
			this.patchClient(client.stream);
		}
	}
}
