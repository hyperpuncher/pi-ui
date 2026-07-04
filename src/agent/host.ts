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
	type SessionStats,
} from "npm:@earendil-works/pi-coding-agent@0.80.3";

import type { AppMessageInput, AppSessionSummary, AppState } from "../state/app-state.ts";

const defaultProvider = "opencode-go";
const defaultModelId = "deepseek-v4-flash";

export class AgentHost {
	private unsubscribe: (() => void) | undefined;
	private readonly toolMessageIds = new Map<string, string>();
	private readonly toolCallArgs = new Map<string, unknown>();

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
		this.syncUsage();
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
		this.syncUsage();
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
		this.toolCallArgs.clear();
		await session.bindExtensions({ mode: "rpc" });
		this.unsubscribe = session.subscribe((event) => this.handleEvent(event, session));
		this.syncModels();
		this.syncUsage();
		this.state.setStatus(this.readyStatus(session));
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
				this.syncUsage();
				break;
			case "tool_execution_start": {
				this.toolCallArgs.set(event.toolCallId, event.args);
				const id = this.state.appendMessage(
					"tool",
					formatToolInput(event.toolName, event.args),
					{
						title: toolTitle("running", event.toolName, event.args),
						meta: toolMeta(event.toolName, event.args),
						state: "running",
					},
				);
				this.toolMessageIds.set(event.toolCallId, id);
				break;
			}
			case "tool_execution_update": {
				const id = this.toolMessageIds.get(event.toolCallId);
				if (id) {
					this.state.updateMessage(id, {
						text: extractToolText(event.partialResult),
						meta: toolMeta(event.toolName, event.args),
					});
				}
				break;
			}
			case "tool_execution_end": {
				const id = this.toolMessageIds.get(event.toolCallId);
				const args = this.toolCallArgs.get(event.toolCallId) ?? {};
				const resultView = formatToolResult(event.toolName, event.result);
				const patch = {
					text: resultView.text,
					title: toolTitle(
						event.isError ? "error" : "success",
						event.toolName,
						args,
					),
					meta: toolMeta(event.toolName, args),
					state: event.isError ? "error" : "success",
					format: resultView.format,
				} as const;
				if (id) {
					this.state.updateMessage(id, patch);
					this.toolMessageIds.delete(event.toolCallId);
				} else {
					this.state.appendMessage("tool", patch.text, patch);
				}
				this.toolCallArgs.delete(event.toolCallId);
				break;
			}
			case "agent_end":
				this.syncUsage();
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

	private readyStatus(session: AgentSession): string {
		const modelName = session.model?.name ?? session.model?.id ?? "no model selected";
		return `Ready • ${modelName} • thinking off`;
	}

	private syncUsage(): void {
		this.state.setUsageText(formatStats(this.runtime.session.getSessionStats()));
	}

	private loadCurrentSessionMessages(): void {
		const branch = this.runtime.session.sessionManager.getBranch();
		const visibleBranch = branch.slice(-160);
		const messages = visibleBranch
			.map((entry: SessionEntry) => this.entryToMessage(entry))
			.filter((message): message is AppMessageInput => Boolean(message));
		if (branch.length > visibleBranch.length) {
			messages.unshift({
				role: "system",
				text: `Showing latest ${visibleBranch.length} session entries. ${branch.length - visibleBranch.length} older entries hidden for performance.`,
				timestamp: new Date(),
			});
		}
		this.state.replaceMessages(messages);
		this.syncUsage();
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
		if (entry.type === "model_change" || entry.type === "thinking_level_change") {
			return undefined;
		}
		return undefined;
	}

	private handleMessageStart(
		message: Extract<AgentSessionEvent, { type: "message_start" }>["message"],
	): void {
		if (message.role === "toolResult") {
			return;
		}
		const appMessage = this.agentMessageToAppMessage(message, new Date());
		if (!appMessage) {
			return;
		}
		this.state.appendMessage(appMessage.role, appMessage.text, {
			title: appMessage.title,
			meta: appMessage.meta,
			state: appMessage.state,
			format: appMessage.format,
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
					title: `Tool result • ${message.toolName}`,
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
		subtitle: `${messageLabel} • ${truncate(info.cwd, 64)}`,
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

function formatStats(stats: SessionStats): string {
	const cost = formatCost(stats.cost);
	if (stats.contextUsage) {
		return `${cost} • ${formatPercent(stats.contextUsage.percent)}/${formatTokens(
			stats.contextUsage.contextWindow,
		)}`;
	}
	return `${cost} • ${formatTokens(stats.tokens.total)} tokens`;
}

function formatTokens(count: number): string {
	if (count < 1_000) return count.toString();
	if (count < 10_000) return `${(count / 1_000).toFixed(1)}k`;
	if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
	if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
	return `${Math.round(count / 1_000_000)}M`;
}

function formatCost(cost: number): string {
	if (cost < 1) return `$${cost.toFixed(3)}`;
	if (cost < 100) return `$${cost.toFixed(1)}`;
	return `$${Math.round(cost)}`;
}

function formatPercent(value: number | null): string {
	return typeof value === "number" ? `${value.toFixed(1)}%` : "?";
}

function truncate(value: string, maxLength: number): string {
	return value.length > maxLength ? `${value.slice(0, maxLength - 1)}…` : value;
}

function toolTitle(
	status: "running" | "success" | "error",
	toolName: string,
	args: unknown,
): string {
	const icon =
		status === "running" ? "Running" : status === "error" ? "Failed" : "Done";
	const target = toolTarget(toolName, args);
	return target ? `${icon} ${toolName} • ${target}` : `${icon} ${toolName}`;
}

function toolMeta(toolName: string, args: unknown): string | undefined {
	const record = asRecord(args);
	if (!record) return undefined;
	if (toolName === "bash" && typeof record.timeout === "number") {
		return `${record.timeout}s timeout`;
	}
	if (toolName === "edit" && Array.isArray(record.edits)) {
		return `${record.edits.length} edit${record.edits.length === 1 ? "" : "s"}`;
	}
	if (typeof record.limit === "number") {
		return `limit ${record.limit}`;
	}
	return undefined;
}

function toolTarget(toolName: string, args: unknown): string {
	const record = asRecord(args);
	if (!record) return "";
	if (toolName === "bash") return stringValue(record.command);
	if (toolName === "grep") {
		const pattern = stringValue(record.pattern);
		const path = stringValue(record.path);
		return path ? `${pattern} in ${path}` : pattern;
	}
	if (toolName === "find") {
		const pattern = stringValue(record.pattern);
		const path = stringValue(record.path);
		return path ? `${pattern} in ${path}` : pattern;
	}
	return stringValue(record.path) || stringValue(record.file_path);
}

function formatToolInput(toolName: string, args: unknown): string {
	const record = asRecord(args);
	if (!record) return summarizeValue(args);
	if (toolName === "bash") return `$ ${stringValue(record.command)}`;
	if (toolName === "read") return `Reading ${stringValue(record.path)}`;
	if (toolName === "ls") return `Listing ${stringValue(record.path) || "."}`;
	if (toolName === "grep") return `Searching ${stringValue(record.pattern)}`;
	if (toolName === "find") return `Finding ${stringValue(record.pattern)}`;
	if (toolName === "write") {
		return `Writing ${stringValue(record.path)} (${stringValue(record.content).length} chars)`;
	}
	if (toolName === "edit") {
		const count = Array.isArray(record.edits) ? record.edits.length : 0;
		return `Editing ${stringValue(record.path)} (${count} replacement${count === 1 ? "" : "s"})`;
	}
	return summarizeValue(args);
}

function formatToolResult(
	toolName: string,
	result: unknown,
): { text: string; format?: "pre" | "diff" } {
	const record = asRecord(result);
	const details = asRecord(record?.details);
	if (toolName === "edit" && typeof details?.patch === "string") {
		return { text: details.patch, format: "diff" };
	}
	if (toolName === "edit" && typeof details?.diff === "string") {
		return { text: details.diff, format: "diff" };
	}
	return { text: extractToolText(result), format: "pre" };
}

function extractToolText(result: unknown): string {
	const record = asRecord(result);
	if (record?.content !== undefined) {
		const text = contentToText(record.content);
		if (text.trim()) return text;
	}
	if (record?.text !== undefined) {
		return stripAnsi(String(record.text));
	}
	if (result instanceof Error) {
		return result.message;
	}
	if (typeof result === "string") {
		return stripAnsi(result);
	}
	return summarizeValue(result);
}

function stringValue(value: unknown): string {
	return typeof value === "string" ? value : "";
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
	return isRecord(value) ? value : undefined;
}

function contentToText(content: unknown): string {
	if (typeof content === "string") {
		return stripAnsi(content);
	}
	if (!Array.isArray(content)) {
		return summarizeValue(content);
	}
	return content
		.map((part) => {
			if (isRecord(part) && part.type === "text" && typeof part.text === "string") {
				return stripAnsi(part.text);
			}
			if (isRecord(part) && part.type === "image") {
				return `[image: ${String(part.mimeType ?? "unknown")}]`;
			}
			if (isRecord(part) && part.type === "thinking") {
				return "";
			}
			if (isRecord(part) && part.type === "toolCall") {
				return "";
			}
			return summarizeValue(part);
		})
		.filter(Boolean)
		.join("\n");
}

const ansiPattern = new RegExp(
	String.raw`[\u001B\u009B][[\]()#;?]*(?:(?:(?:[a-zA-Z\d]*(?:;[a-zA-Z\d]*)*)?\u0007)|(?:(?:\d{1,4}(?:;\d{0,4})*)?[\dA-PR-TZcf-nq-uy=><~]))`,
	"g",
);

function stripAnsi(value: string): string {
	return value.replace(ansiPattern, "");
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
