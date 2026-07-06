import { appCommands } from "../commands/registry.ts";
import type { DatastarStream } from "../server/datastar.ts";
import { datastarStream } from "../server/datastar.ts";
import { renderDebugOverlay } from "../ui/debug.tsx";
import {
	renderCodeFinal,
	renderMarkdownFinal,
	renderMarkdownStreaming,
} from "../ui/markdown.tsx";
import { renderMessage, renderMessages } from "../ui/messages.tsx";
import { renderSessionPicker, renderSlashPicker } from "../ui/pickers.tsx";
import {
	renderPromptAction,
	renderPromptStatus,
	renderModelPicker,
	renderThinkingPicker,
	renderWorkspacePicker,
} from "../ui/prompt-box.tsx";
import { renderTreePicker } from "../ui/tree-picker.tsx";
import { formatShortcut } from "../utils/keyboard.ts";
import { defaultWorkspacePath } from "../utils/workspace.ts";

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

export type AppTreeEntry = {
	id: string;
	parentId: string | null;
	prefix: string;
	continuationPrefix: string;
	label?: string;
	role: string;
	text: string;
	meta: string;
	active: boolean;
	inPath: boolean;
};

export type AppUsage = {
	text: string;
	contextPercent?: number;
};

export type AppKeybindHint = {
	keys: string;
	description: string;
};

export type AppMessageInput = Omit<AppMessage, "id" | "renderedHtml"> & {
	renderedHtml?: string;
};

type StreamClient = {
	id: string;
	stream: DatastarStream;
};

const finalizeRecentMessageCount = 24;
const emptyChatHints: AppKeybindHint[] = [
	...appCommands
		.filter((command) => command.shortcut.display)
		.map((command) => ({
			keys: formatShortcut(command.shortcut.display),
			description: command.description,
		})),
	{ keys: "alt T", description: "Cycle thinking level." },
	{ keys: "@", description: "Attach a file path." },
	{ keys: "/", description: "Open slash commands and skills." },
];
const markdownMessageRoles = new Set<AppMessage["role"]>([
	"assistant",
	"thought",
	"compaction",
	"skill",
]);

function rendersMarkdown(role: AppMessage["role"]): boolean {
	return markdownMessageRoles.has(role);
}

function randomEmptyChatHint(): AppKeybindHint {
	return emptyChatHints[Math.floor(Math.random() * emptyChatHints.length)];
}

function debugUiEnabled(): boolean {
	return Deno.env.get("PI_UI_DEBUG") === "1";
}

export class AppState {
	private clients = new Map<string, StreamClient>();
	private messageSeq = 0;
	private activeAssistantId: string | undefined;
	private activeThoughtId: string | undefined;
	private streamingPatchTimer: ReturnType<typeof setTimeout> | undefined;
	readonly debugUi = debugUiEnabled();
	streamingPatchIntervalMs = 7;
	messages: AppMessage[] = [];
	models: AppModel[] = [];
	sessions: AppSessionSummary[] = [];
	treeEntries: AppTreeEntry[] = [];
	slashCommands: AppSlashCommand[] = [];
	currentModel: string | undefined;
	thinkingLevel: AppThinkingLevel = "off";
	thinkingLevels: AppThinkingLevel[] = ["off"];
	usage: AppUsage = { text: "$0.000 • 0 tokens" };
	emptyChatHint = randomEmptyChatHint();
	activityText: string | undefined;
	workspacePath = defaultWorkspacePath();

	createStream(signal: AbortSignal): Response {
		const id = crypto.randomUUID();
		return datastarStream(
			(stream) => {
				this.clients.set(id, { id, stream });
				this.patchClient(stream);
				this.patchSignals(stream);
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
					? renderMarkdownStreaming(text, { cacheKey: id })
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
		this.scheduleStreamingPatch();
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
		this.scheduleStreamingPatch();
	}

	finishAssistant(): void {
		this.flushStreamingPatch();
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
		this.clearStreamingPatchTimer();
		this.messages = [];
		this.activeAssistantId = undefined;
		this.activeThoughtId = undefined;
		this.emptyChatHint = randomEmptyChatHint();
		this.broadcast();
	}

	replaceMessages(messages: AppMessageInput[]): void {
		this.clearStreamingPatchTimer();
		this.activeAssistantId = undefined;
		this.activeThoughtId = undefined;
		if (messages.length === 0) {
			this.emptyChatHint = randomEmptyChatHint();
		}
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
						? renderMarkdownStreaming(message.text, { cacheKey: id })
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
		this.broadcastSignals();
	}

	setThinking(level: AppThinkingLevel, levels: AppThinkingLevel[]): void {
		this.thinkingLevel = level;
		this.thinkingLevels = levels.length > 0 ? levels : ["off"];
		this.broadcast();
		this.broadcastSignals();
	}

	setSessions(sessions: AppSessionSummary[]): void {
		this.sessions = sessions;
		this.broadcast();
	}

	setSlashCommands(commands: AppSlashCommand[]): void {
		this.slashCommands = commands;
		this.broadcast();
	}

	setTreeEntries(entries: AppTreeEntry[]): void {
		this.treeEntries = entries;
		this.broadcast();
	}

	setCurrentModel(currentModel: string | undefined): void {
		this.currentModel = currentModel;
		this.broadcast();
		this.broadcastSignals();
	}

	setUsage(usage: AppUsage): void {
		this.usage = usage;
		this.broadcast();
	}

	setActivityText(activityText: string | undefined): void {
		this.activityText = activityText;
		this.broadcast();
	}

	setWorkspacePath(workspacePath: string): void {
		this.workspacePath = workspacePath;
		this.broadcast();
		this.broadcastSignals();
	}

	get streamingPatchRateHz(): number {
		return Math.round(1000 / this.streamingPatchIntervalMs);
	}

	private scheduleStreamingPatch(): void {
		if (this.streamingPatchTimer !== undefined) return;
		this.streamingPatchTimer = setTimeout(() => {
			this.streamingPatchTimer = undefined;
			this.flushStreamingPatch();
		}, this.streamingPatchIntervalMs);
	}

	private clearStreamingPatchTimer(): void {
		if (this.streamingPatchTimer === undefined) return;
		clearTimeout(this.streamingPatchTimer);
		this.streamingPatchTimer = undefined;
	}

	private flushStreamingPatch(): void {
		this.clearStreamingPatchTimer();
		if (this.activeThoughtId) {
			this.patchStreamingMessage(this.activeThoughtId);
		}
		if (this.activeAssistantId) {
			this.patchStreamingMessage(this.activeAssistantId);
		}
	}

	private patchStreamingMessage(id: string): void {
		const message = this.messages.find((item) => item.id === id);
		if (!message || !rendersMarkdown(message.role) || !message.text.trim()) return;
		message.renderedHtml = renderMarkdownStreaming(message.text, { cacheKey: id });
		this.broadcastMessage(message);
	}

	private async renderCode(id: string, language: string): Promise<void> {
		const message = this.messages.find((item) => item.id === id);
		if (!message || !message.text.trim()) {
			return;
		}

		const text = message.text;
		const renderedHtml = await renderCodeFinal(text, language, { chrome: false });
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
			renderMessages(this.messages, this.emptyChatHint) +
			renderPromptAction(this) +
			renderPromptStatus(this) +
			renderWorkspacePicker(this) +
			renderModelPicker(this) +
			renderThinkingPicker(this) +
			renderDebugOverlay(this) +
			renderSessionPicker(this) +
			renderSlashPicker(this) +
			renderTreePicker(this)
		);
	}

	private patchClient(stream: DatastarStream): void {
		try {
			stream.patchElements(this.renderElements());
		} catch {
			// Client already disconnected.
		}
	}

	private patchSignals(stream: DatastarStream): void {
		try {
			stream.patchSignals(
				JSON.stringify({
					model: this.currentModel ?? "",
					thinkingLevel: this.thinkingLevel,
					workspacePath: this.workspacePath,
					treeEntryId: "",
					treeSummarize: false,
					treeSummaryInstructions: "",
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

	private broadcastMessage(message: AppMessage): void {
		for (const client of this.clients.values()) {
			try {
				client.stream.patchElements(renderMessage(message), {
					selector: `[data-message-id="${message.id}"]`,
				});
			} catch {
				// Client already disconnected.
			}
		}
	}

	private broadcastSignals(): void {
		for (const client of this.clients.values()) {
			this.patchSignals(client.stream);
		}
	}
}
