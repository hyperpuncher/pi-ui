import {
	createAgentSessionFromServices,
	createAgentSessionRuntime,
	createAgentSessionServices,
	getAgentDir,
	SessionManager,
	type AgentSession,
	type AgentSessionEvent,
	type AgentSessionRuntime,
	type CreateAgentSessionRuntimeFactory,
	type SessionEntry,
	type SessionInfo,
} from "npm:@earendil-works/pi-coding-agent@0.80.3";

import type { AppMessageInput, AppSessionSummary, AppState } from "../state/app-state.ts";

const defaultProvider = "opencode-go";
const defaultModelId = "deepseek-v4-flash";

export class AgentHost {
	private unsubscribe: (() => void) | undefined;
	private readonly toolMessageIds = new Map<string, string>();

	private constructor(
		private readonly runtime: AgentSessionRuntime,
		private readonly state: AppState,
	) {}

	static async create(state: AppState): Promise<AgentHost> {
		const cwd = Deno.cwd();
		const createRuntime: CreateAgentSessionRuntimeFactory = async ({
			cwd,
			sessionManager,
			sessionStartEvent,
		}) => {
			const services = await createAgentSessionServices({ cwd });
			const model = services.modelRegistry.find(defaultProvider, defaultModelId);
			return {
				...(await createAgentSessionFromServices({
					services,
					sessionManager,
					sessionStartEvent,
					model,
					thinkingLevel: "off",
				})),
				services,
				diagnostics: services.diagnostics,
			};
		};

		const runtime = await createAgentSessionRuntime(createRuntime, {
			cwd,
			agentDir: getAgentDir(),
			sessionManager: SessionManager.create(cwd),
		});

		const host = new AgentHost(runtime, state);
		await host.bindSession();
		return host;
	}

	async prompt(text: string): Promise<boolean> {
		const trimmed = text.trim();
		if (!trimmed) {
			return false;
		}

		this.state.setStatus(
			this.runtime.session.isStreaming ? "Queued follow-up" : "Sending prompt",
		);

		let resolveAccepted: (accepted: boolean) => void = () => {};
		let settled = false;
		const accepted = new Promise<boolean>((resolve) => {
			resolveAccepted = (value) => {
				if (settled) {
					return;
				}
				settled = true;
				resolve(value);
			};
		});

		this.runtime.session
			.prompt(trimmed, {
				streamingBehavior: this.runtime.session.isStreaming
					? "followUp"
					: undefined,
				preflightResult: resolveAccepted,
			})
			.catch((error: unknown) => {
				resolveAccepted(false);
				this.state.appendMessage("system", formatError(error));
				this.state.setStatus("Prompt failed");
			});

		return await accepted;
	}

	async abort(): Promise<void> {
		await this.runtime.session.abort();
		this.state.setStatus("Aborted");
	}

	async newSession(): Promise<boolean> {
		const result = await this.runtime.newSession();
		if (result.cancelled) {
			this.state.setStatus("New chat cancelled");
			return false;
		}
		this.state.resetChat();
		await this.bindSession();
		return true;
	}

	async listSessions(): Promise<void> {
		this.state.setStatus("Loading sessions");
		const sessionManager = this.runtime.session.sessionManager;
		const sessions = await SessionManager.list(
			sessionManager.getCwd(),
			sessionManager.getSessionDir(),
		);
		this.state.setSessions(sessions.slice(0, 50).map(formatSessionSummary));
		this.state.setStatus(this.readyStatus(this.runtime.session));
	}

	async resumeSession(sessionPath: string): Promise<boolean> {
		if (!sessionPath.trim()) {
			return false;
		}
		this.state.setStatus("Resuming session");
		const result = await this.runtime.switchSession(sessionPath);
		if (result.cancelled) {
			this.state.setStatus("Resume cancelled");
			return false;
		}
		await this.bindSession();
		this.loadCurrentSessionMessages();
		return true;
	}

	async setModel(modelRef: string): Promise<boolean> {
		const [provider, ...idParts] = modelRef.split("/");
		const modelId = idParts.join("/");
		if (!provider || !modelId) {
			return false;
		}
		const model = this.runtime.session.modelRegistry.find(provider, modelId);
		if (!model) {
			this.state.appendMessage("system", `Model not found: ${modelRef}`);
			return false;
		}
		await this.runtime.session.setModel(model);
		this.syncModels();
		this.state.setStatus(this.readyStatus(this.runtime.session));
		return true;
	}

	dispose(): void {
		this.unsubscribe?.();
		this.runtime.dispose();
	}

	private async bindSession(): Promise<void> {
		this.unsubscribe?.();
		const session = this.runtime.session;
		this.toolMessageIds.clear();
		await session.bindExtensions({ mode: "rpc" });
		this.unsubscribe = session.subscribe((event) => this.handleEvent(event, session));
		const defaultMissing =
			session.model?.provider === defaultProvider &&
			session.model?.id === defaultModelId
				? ""
				: " · default model unavailable";
		this.syncModels();
		this.state.setStatus(this.readyStatus(session, defaultMissing));
	}

	private syncModels(): void {
		const session = this.runtime.session;
		const currentModel = session.model
			? `${session.model.provider}/${session.model.id}`
			: undefined;
		const models = session.modelRegistry
			.getAll()
			.map((model) => ({
				id: model.id,
				provider: model.provider,
				name: model.name ?? model.id,
				configured: session.modelRegistry.hasConfiguredAuth(model),
			}))
			.filter(
				(model) =>
					model.configured ||
					`${model.provider}/${model.id}` === currentModel ||
					(model.provider === defaultProvider && model.id === defaultModelId),
			)
			.sort((a, b) => {
				const aDefault =
					a.provider === defaultProvider && a.id === defaultModelId ? 0 : 1;
				const bDefault =
					b.provider === defaultProvider && b.id === defaultModelId ? 0 : 1;
				const aConfigured = a.configured ? 0 : 1;
				const bConfigured = b.configured ? 0 : 1;
				return (
					aDefault - bDefault ||
					aConfigured - bConfigured ||
					a.provider.localeCompare(b.provider) ||
					a.name.localeCompare(b.name)
				);
			});
		this.state.setModels(models, currentModel);
	}

	private handleEvent(event: AgentSessionEvent, session: AgentSession): void {
		switch (event.type) {
			case "message_start":
				this.handleMessageStart(event.message);
				break;
			case "message_update":
				if (event.assistantMessageEvent.type === "text_delta") {
					this.state.appendAssistantDelta(event.assistantMessageEvent.delta);
				}
				break;
			case "message_end":
				if (event.message.role === "assistant") {
					this.state.finishAssistant();
				}
				break;
			case "tool_execution_start": {
				const id = this.state.appendMessage("tool", summarizeValue(event.args), {
					title: `Running ${event.toolName}`,
					meta: event.toolCallId,
					state: "running",
				});
				this.toolMessageIds.set(event.toolCallId, id);
				break;
			}
			case "tool_execution_end": {
				const id = this.toolMessageIds.get(event.toolCallId);
				const patch = {
					text: summarizeValue(event.result),
					title: `${event.isError ? "Failed" : "Finished"} ${event.toolName}`,
					state: event.isError ? "error" : "success",
				} as const;
				if (id) {
					this.state.updateMessage(id, patch);
					this.toolMessageIds.delete(event.toolCallId);
				} else {
					this.state.appendMessage("tool", patch.text, patch);
				}
				break;
			}
			case "agent_end":
				this.state.setStatus(this.readyStatus(session));
				break;
			case "queue_update":
				this.state.setStatus(
					`Queued ${event.steering.length + event.followUp.length} message(s)`,
				);
				break;
			case "auto_retry_start":
				this.state.setStatus(`Retrying ${event.attempt}/${event.maxAttempts}`);
				break;
			case "compaction_start":
				this.state.setStatus(`Compacting (${event.reason})`);
				break;
			case "compaction_end":
				this.state.setStatus(event.errorMessage ?? "Compaction complete");
				break;
		}
	}

	private readyStatus(session: AgentSession, suffix = ""): string {
		const modelName = session.model?.name ?? session.model?.id ?? "no model selected";
		return `Ready · ${modelName} · thinking off${suffix}`;
	}

	private loadCurrentSessionMessages(): void {
		const messages = this.runtime.session.sessionManager
			.getBranch()
			.map((entry: SessionEntry) => this.entryToMessage(entry))
			.filter((message): message is AppMessageInput => Boolean(message));
		this.state.replaceMessages(messages);
		this.state.setStatus(this.readyStatus(this.runtime.session));
	}

	private entryToMessage(entry: SessionEntry): AppMessageInput | undefined {
		const timestamp = new Date(entry.timestamp);
		if (entry.type === "message") {
			return this.agentMessageToAppMessage(entry.message, timestamp);
		}
		if (entry.type === "custom_message" && entry.display) {
			return {
				role: "system",
				text: contentToText(entry.content),
				timestamp,
			};
		}
		if (entry.type === "compaction") {
			return { role: "system", text: entry.summary, timestamp };
		}
		if (entry.type === "branch_summary") {
			return { role: "system", text: entry.summary, timestamp };
		}
		if (entry.type === "model_change") {
			return {
				role: "system",
				text: `Model changed to ${entry.provider}/${entry.modelId}`,
				timestamp,
			};
		}
		if (entry.type === "thinking_level_change") {
			return {
				role: "system",
				text: `Thinking changed to ${entry.thinkingLevel}`,
				timestamp,
			};
		}
		return undefined;
	}

	private handleMessageStart(
		message: Extract<AgentSessionEvent, { type: "message_start" }>["message"],
	): void {
		const appMessage = this.agentMessageToAppMessage(message, new Date());
		if (!appMessage) {
			return;
		}
		this.state.appendMessage(appMessage.role, appMessage.text, {
			title: appMessage.title,
			meta: appMessage.meta,
			state: appMessage.state,
		});
	}

	private agentMessageToAppMessage(
		message: Extract<AgentSessionEvent, { type: "message_start" }>["message"],
		timestamp: Date,
	): AppMessageInput | undefined {
		switch (message.role) {
			case "user":
				return { role: "user", text: contentToText(message.content), timestamp };
			case "assistant":
				return {
					role: "assistant",
					text: contentToText(message.content),
					timestamp,
				};
			case "toolResult":
				return {
					role: "tool",
					text: contentToText(message.content),
					timestamp,
					title: `Tool result · ${message.toolName}`,
					meta: message.isError ? "error" : "ok",
					state: message.isError ? "error" : "success",
				};
			case "bashExecution":
				return {
					role: "tool",
					text: `$ ${message.command}\n${message.output}`,
					timestamp,
					title: "Shell command",
					meta:
						message.exitCode === undefined
							? "cancelled"
							: `exit ${message.exitCode}`,
					state: message.exitCode === 0 ? "success" : "error",
				};
			case "custom":
				if (message.display) {
					return {
						role: "system",
						text: contentToText(message.content),
						timestamp,
					};
				}
				return undefined;
			case "branchSummary":
				return { role: "system", text: message.summary, timestamp };
			case "compactionSummary":
				return { role: "system", text: message.summary, timestamp };
		}
	}
}

function formatSessionSummary(info: SessionInfo): AppSessionSummary {
	const title = info.name?.trim() || info.firstMessage.trim() || "Untitled session";
	const messageLabel = `${info.messageCount} message${info.messageCount === 1 ? "" : "s"}`;
	return {
		path: info.path,
		title: truncate(title, 96),
		subtitle: `${messageLabel} · ${truncate(info.cwd, 64)}`,
		modified: formatDate(info.modified),
	};
}

function formatDate(date: Date): string {
	return date.toLocaleString(undefined, {
		month: "short",
		day: "numeric",
		hour: "2-digit",
		minute: "2-digit",
	});
}

function truncate(value: string, maxLength: number): string {
	return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function contentToText(content: unknown): string {
	if (typeof content === "string") {
		return content;
	}
	if (!Array.isArray(content)) {
		return summarizeValue(content);
	}
	return content
		.map((part) => {
			if (isRecord(part) && part.type === "text" && typeof part.text === "string") {
				return part.text;
			}
			if (isRecord(part) && part.type === "image") {
				return `[image: ${String(part.mimeType ?? "unknown")}]`;
			}
			if (
				isRecord(part) &&
				part.type === "thinking" &&
				typeof part.thinking === "string"
			) {
				return `[thinking]\n${part.thinking}`;
			}
			if (isRecord(part) && part.type === "toolCall") {
				return `[tool call: ${String(part.name ?? "unknown")}]`;
			}
			return summarizeValue(part);
		})
		.filter(Boolean)
		.join("\n");
}

function summarizeValue(value: unknown): string {
	if (typeof value === "string") {
		return value;
	}
	try {
		return JSON.stringify(value, null, 2);
	} catch {
		return String(value);
	}
}

function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}

function isRecord(value: unknown): value is Record<string, unknown> {
	return typeof value === "object" && value !== null;
}
