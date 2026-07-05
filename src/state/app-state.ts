import type { DatastarStream } from "../server/datastar.ts";
import { datastarStream } from "../server/datastar.ts";
import {
	renderComposerStatus,
	renderModelPicker,
	renderSessionPicker,
	renderSlashPicker,
	renderThinkingPicker,
	renderTranscript,
	renderWorkspacePicker,
} from "../ui/fragments.tsx";
import {
	renderCodeFinal,
	renderMarkdownFinal,
	renderMarkdownStreaming,
} from "../ui/markdown.ts";

export type AppMessage = {
	id: string;
	role: "user" | "assistant" | "system" | "tool" | "thought" | "compaction" | "skill";
	text: string;
	timestamp: Date;
	title?: string;
	titleParts?: AppMessageTitlePart[];
	meta?: string;
	state?: "running" | "success" | "error";
	format?: "pre" | "diff";
	renderedHtml?: string;
};

export type AppMessageTitlePart = {
	text: string;
	tone?: "default" | "accent" | "warning" | "muted";
};

export type AppMessageOptions = Pick<
	AppMessage,
	"title" | "titleParts" | "meta" | "state" | "format"
>;

export type AppModel = {
	id: string;
	provider: string;
	name: string;
	configured: boolean;
};

export type AppThinkingLevel = "off" | "minimal" | "low" | "medium" | "high" | "xhigh";

export type AppSlashCommand = {
	name: string;
	description: string;
	source: "prompt" | "skill" | "extension" | "system";
	argumentHint?: string;
};

export type AppSessionSummary = {
	path: string;
	title: string;
	subtitle: string;
	modified: string;
};

export type AppMessageInput = Omit<AppMessage, "id" | "renderedHtml"> & {
	renderedHtml?: string;
};

type StreamClient = {
	id: string;
	stream: DatastarStream;
};

const finalizeRecentMessageCount = 24;
const markdownMessageRoles = new Set<AppMessage["role"]>([
	"assistant",
	"thought",
	"compaction",
	"skill",
]);

function rendersMarkdown(role: AppMessage["role"]): boolean {
	return markdownMessageRoles.has(role);
}

export class AppState {
	private clients = new Map<string, StreamClient>();
	private messageSeq = 0;
	private activeAssistantId: string | undefined;
	private activeThoughtId: string | undefined;
	messages: AppMessage[] = [];
	models: AppModel[] = [];
	sessions: AppSessionSummary[] = [];
	slashCommands: AppSlashCommand[] = [];
	currentModel: string | undefined;
	thinkingLevel: AppThinkingLevel = "off";
	thinkingLevels: AppThinkingLevel[] = ["off"];
	usageText = "$0.000 • 0 tokens";
	workspacePath = Deno.cwd();

	createStream(signal: AbortSignal): Response {
		const id = crypto.randomUUID();
		return datastarStream(
			(stream) => {
				this.clients.set(id, { id, stream });
				this.patchClient(stream);
				stream.patchSignals(
					JSON.stringify({
						model: this.currentModel ?? "",
						thinkingLevel: this.thinkingLevel,
						workspacePath: this.workspacePath,
					}),
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
				rendersMarkdown(role) && text.trim()
					? renderMarkdownStreaming(text)
					: undefined,
		});
		if (role === "assistant") {
			this.activeAssistantId = id;
		}
		if (role === "thought") {
			this.activeThoughtId = id;
		}
		this.broadcast();
		if (role === "tool" && options.format === "diff" && text.trim()) {
			void this.renderCode(id, "diff");
		}
		return id;
	}

	updateMessage(id: string, patch: Partial<Omit<AppMessage, "id">>): void {
		const message = this.messages.find((item) => item.id === id);
		if (!message) {
			return;
		}
		Object.assign(message, patch);
		if (patch.text !== undefined || patch.format !== undefined) {
			message.renderedHtml = undefined;
		}
		this.broadcast();
		if (message.role === "tool" && message.format === "diff" && message.text.trim()) {
			void this.renderCode(id, "diff");
		}
	}

	appendThoughtDelta(delta: string): void {
		if (!this.activeThoughtId) {
			this.appendMessage("thought", delta);
			return;
		}
		const message = this.messages.find((item) => item.id === this.activeThoughtId);
		if (!message) {
			this.appendMessage("thought", delta);
			return;
		}
		message.text += delta;
		message.renderedHtml = renderMarkdownStreaming(message.text);
		this.broadcast();
	}

	appendAssistantDelta(delta: string): void {
		this.activeThoughtId = undefined;
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
		const thoughtId = this.activeThoughtId;
		this.activeAssistantId = undefined;
		this.activeThoughtId = undefined;
		this.broadcast();
		if (thoughtId) {
			void this.renderAssistantMarkdown(thoughtId);
		}
		if (id) {
			void this.renderAssistantMarkdown(id);
		}
	}

	resetChat(): void {
		this.messages = [];
		this.activeAssistantId = undefined;
		this.activeThoughtId = undefined;
		this.broadcast();
	}

	replaceMessages(messages: AppMessageInput[]): void {
		this.activeAssistantId = undefined;
		this.activeThoughtId = undefined;
		const finalizeFrom = Math.max(0, messages.length - finalizeRecentMessageCount);
		this.messages = messages.map((message, index) => {
			this.messageSeq += 1;
			const id = `m-${this.messageSeq}`;
			const shouldRenderStreaming =
				rendersMarkdown(message.role) &&
				message.text.trim() &&
				index >= finalizeFrom;
			return {
				...message,
				id,
				renderedHtml:
					message.renderedHtml ??
					(shouldRenderStreaming
						? renderMarkdownStreaming(message.text)
						: undefined),
			};
		});
		this.broadcast();
		for (const [index, message] of this.messages.entries()) {
			if (
				index >= finalizeFrom &&
				rendersMarkdown(message.role) &&
				message.text.trim()
			) {
				void this.renderAssistantMarkdown(message.id);
			}
			if (
				index >= finalizeFrom &&
				message.role === "tool" &&
				message.format === "diff" &&
				message.text.trim()
			) {
				void this.renderCode(message.id, "diff");
			}
		}
	}

	setModels(models: AppModel[], currentModel: string | undefined): void {
		this.models = models;
		this.currentModel = currentModel;
		this.broadcast();
	}

	setThinking(level: AppThinkingLevel, levels: AppThinkingLevel[]): void {
		this.thinkingLevel = level;
		this.thinkingLevels = levels.length > 0 ? levels : ["off"];
		this.broadcast();
	}

	setSessions(sessions: AppSessionSummary[]): void {
		this.sessions = sessions;
		this.broadcast();
	}

	setSlashCommands(commands: AppSlashCommand[]): void {
		this.slashCommands = commands;
		this.broadcast();
	}

	setCurrentModel(currentModel: string | undefined): void {
		this.currentModel = currentModel;
		this.broadcast();
	}

	setUsageText(usageText: string): void {
		this.usageText = usageText;
		this.broadcast();
	}

	setWorkspacePath(workspacePath: string): void {
		this.workspacePath = workspacePath;
		this.broadcast();
	}

	private async renderCode(id: string, language: string): Promise<void> {
		const message = this.messages.find((item) => item.id === id);
		if (!message || !message.text.trim()) {
			return;
		}

		const text = message.text;
		const renderedHtml = await renderCodeFinal(text, language);
		const current = this.messages.find((item) => item.id === id);
		if (!current || current.text !== text) {
			return;
		}

		current.renderedHtml = renderedHtml;
		this.broadcast();
	}

	private async renderAssistantMarkdown(id: string): Promise<void> {
		const message = this.messages.find((item) => item.id === id);
		if (!message || !rendersMarkdown(message.role) || !message.text.trim()) {
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
			renderTranscript(this.messages) +
			renderComposerStatus(this) +
			renderWorkspacePicker(this) +
			renderThinkingPicker(this) +
			renderModelPicker(this) +
			renderSessionPicker(this) +
			renderSlashPicker(this)
		);
	}

	private patchClient(stream: DatastarStream): void {
		try {
			stream.patchElements(this.renderElements());
			stream.patchSignals(
				JSON.stringify({
					model: this.currentModel ?? "",
					thinkingLevel: this.thinkingLevel,
					workspacePath: this.workspacePath,
				}),
			);
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
