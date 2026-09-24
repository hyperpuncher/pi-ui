import type { AgentSessionEvent } from "@earendil-works/pi-coding-agent";

import type { ExtensionChannelSnapshot } from "../extension-surface-types.ts";
import {
	liveWorkspaceActivityLimit,
	liveWorkspaceActivityTextLimit,
	liveWorkspaceChannelJsonLimit,
	liveWorkspaceChannelLimit,
	liveWorkspaceChannelRowLimit,
	liveWorkspaceToolPreviewLimit,
	truncateForDisplay,
	type LiveWorkspaceActiveTool,
	type LiveWorkspaceActivityEntry,
	type LiveWorkspaceAgentRow,
	type LiveWorkspaceSnapshot,
	type LiveWorkspaceTurnState,
} from "../live-workspace-types.ts";
import type { JsonValue } from "../utils/json-types.ts";
import { asRecord, isNumber, isString } from "../utils/type-guards.ts";
import { toolTitle } from "./tool-presentation.ts";

export type LiveWorkspaceEventContext = Readonly<{
	background: boolean;
	sessionPath?: string;
}>;

export type LiveWorkspaceSnapshotInput = Readonly<{
	queuedSteering: number;
	queuedFollowUp: number;
}>;

type RetryState = { attempt: number; maxAttempts: number; at: number };
type CompactionState = { reason: "manual" | "threshold" | "overflow" };
type WaitingState = { kind: string; title: string | undefined };
type ActiveToolState = {
	toolName: string;
	startedAt: number;
	summary?: string;
	preview?: string;
};

/**
 * Aggregates cross-cutting "what's happening now" state for the Live Workspace pane: turn
 * phase, in-flight tool calls, background-session/extension-channel rosters, and a bounded
 * activity log of the session events the core reducer otherwise drops (server-arch.md §2).
 *
 * Pure state, no AppStore/SDK dependency — `RuntimeController` feeds it raw `AgentSessionEvent`s
 * and host-extension callbacks, then reads `snapshot()` to publish into `AppStore`. This mirrors
 * `reduceSessionEvent`'s "pure function + fake sink" shape so it stays unit-testable in isolation
 * (see testing.md §1.3).
 */
export class LiveWorkspaceController {
	private revision = 0;
	private running = false;
	private retry: RetryState | undefined;
	private compaction: CompactionState | undefined;
	private waiting: WaitingState | undefined;
	/** Pending `custom()` calls, split by whether they take keyboard focus (see `trackCustomPrompt`). */
	private capturingCustoms = 0;
	private ambientCustoms = 0;
	private readonly activeTools = new Map<string, ActiveToolState>();
	private readonly agents = new Map<string, LiveWorkspaceAgentRow>();
	private readonly backgroundToolCounts = new Map<string, number>();
	private readonly channels = new Map<string, ExtensionChannelSnapshot>();
	private activity: LiveWorkspaceActivityEntry[] = [];
	private nextActivityId = 0;

	/**
	 * Feeds one raw session event and reports whether any tracked state changed. Events the
	 * pane does not track (e.g. every streamed `message_update` delta) are true no-ops: the
	 * revision is left alone so `AppStore.setLiveWorkspace` can skip the re-render entirely.
	 * Never throws — a malformed event is logged, not fatal.
	 */
	recordEvent(event: AgentSessionEvent, context: LiveWorkspaceEventContext): boolean {
		let changed: boolean;
		try {
			changed = context.background
				? this.recordBackgroundEvent(event, context.sessionPath)
				: this.recordForegroundEvent(event);
		} catch (error) {
			this.pushActivity(
				"error",
				`Live Workspace could not record an event: ${errorText(error)}`,
				context.background,
			);
			changed = true;
		}
		if (changed) this.revision += 1;
		return changed;
	}

	private recordForegroundEvent(event: AgentSessionEvent): boolean {
		switch (event.type) {
			case "agent_start":
				this.running = true;
				this.retry = undefined;
				this.compaction = undefined;
				return true;
			case "agent_settled":
				this.running = false;
				this.retry = undefined;
				this.compaction = undefined;
				this.waiting = undefined;
				// A#19: an aborted or finished run must not leave stale "running" tool rows —
				// `tool_execution_end` is not guaranteed for every in-flight call on abort.
				this.activeTools.clear();
				return true;
			case "auto_retry_start":
				this.retry = {
					attempt: event.attempt,
					maxAttempts: event.maxAttempts,
					at: Date.now() + Math.max(0, event.delayMs),
				};
				this.pushActivity(
					"retry",
					`Retrying (${event.attempt}/${event.maxAttempts}) after: ${event.errorMessage}`,
					false,
				);
				return true;
			case "auto_retry_end":
				this.retry = undefined;
				if (!event.success) {
					this.pushActivity(
						"retry",
						`Retry failed: ${event.finalError ?? "unknown error"}`,
						false,
					);
				}
				return true;
			case "compaction_start":
				this.compaction = { reason: event.reason };
				this.pushActivity(
					"compaction",
					`Compacting context (${event.reason})`,
					false,
				);
				return true;
			case "compaction_end":
				this.compaction = undefined;
				this.pushActivity(
					"compaction",
					event.aborted ? "Compaction aborted" : "Compaction finished",
					false,
				);
				return true;
			case "turn_end":
				this.pushActivity("turn", "Turn finished", false);
				return true;
			case "session_info_changed":
				if (!event.name) return false;
				this.pushActivity("session", `Session renamed to "${event.name}"`, false);
				return true;
			case "thinking_level_changed":
				this.pushActivity(
					"model",
					`Thinking level changed to ${event.level}`,
					false,
				);
				return true;
			case "summarization_retry_scheduled":
				this.pushActivity(
					"retry",
					`Summarization retry scheduled (${event.attempt}/${event.maxAttempts})`,
					false,
				);
				return true;
			case "summarization_retry_attempt_start":
				this.pushActivity(
					"retry",
					`Summarization retry attempt started (${event.source})`,
					false,
				);
				return true;
			case "summarization_retry_finished":
				this.pushActivity("retry", "Summarization retry finished", false);
				return true;
			case "tool_execution_start":
				this.activeTools.set(event.toolCallId, {
					toolName: event.toolName,
					startedAt: Date.now(),
					// SAFETY: `toolTitle` only reads plain JSON-shaped fields off `args` (via
					// `asRecord`) and tolerates any other shape, so the SDK's `any` is safe here.
					summary: toolTitle(
						"running",
						event.toolName,
						(event.args ?? null) as JsonValue,
					),
				});
				return true;
			case "tool_execution_update": {
				const tool = this.activeTools.get(event.toolCallId);
				if (!tool) return false;
				const preview = summarizePartialResult(event.partialResult);
				if (preview === tool.preview) return false;
				tool.preview = preview;
				return true;
			}
			case "tool_execution_end":
				return this.activeTools.delete(event.toolCallId);
			// The Now tab shows queued steering/follow-up counts read from AppStore.
			case "queue_update":
				return true;
			default:
				return false;
		}
	}

	private recordBackgroundEvent(
		event: AgentSessionEvent,
		sessionPath: string | undefined,
	): boolean {
		if (!sessionPath) return false;
		if (event.type === "tool_execution_start") {
			this.backgroundToolCounts.set(
				sessionPath,
				(this.backgroundToolCounts.get(sessionPath) ?? 0) + 1,
			);
			return true;
		}
		if (event.type === "tool_execution_end") {
			const count = (this.backgroundToolCounts.get(sessionPath) ?? 0) - 1;
			if (count > 0) this.backgroundToolCounts.set(sessionPath, count);
			else this.backgroundToolCounts.delete(sessionPath);
			return true;
		}
		if (event.type === "agent_settled") {
			this.pushActivity("background", "Background session settled", true);
			return true;
		}
		return false;
	}

	/** Registers or updates a pi-ui background session row (see runtime-controller.ts `BackgroundSession`). */
	setBackgroundSession(
		sessionPath: string,
		status: "running" | "completed",
		label: string,
		startedAt: number,
	): void {
		this.agents.set(sessionPath, {
			id: sessionPath,
			kind: "background-session",
			source: "pi-ui",
			label,
			status,
			depth: 0,
			startedAt,
		});
		this.revision += 1;
	}

	removeBackgroundSession(sessionPath: string): void {
		this.agents.delete(sessionPath);
		this.backgroundToolCounts.delete(sessionPath);
		this.revision += 1;
	}

	/** Marks a tracked background session row as finished, leaving its other fields intact. */
	markBackgroundSessionCompleted(sessionPath: string): void {
		const agent = this.agents.get(sessionPath);
		if (!agent || agent.kind !== "background-session") return;
		this.agents.set(sessionPath, { ...agent, status: "completed" });
		this.revision += 1;
	}

	/**
	 * Clears foreground-scoped state when a different session becomes the foreground session,
	 * so the previous session's state never bleeds into the new one: the Now tab's turn phase
	 * and active tools, plus extension channels and the roster rows derived from them (each
	 * runtime has its own extensions and event bus, which re-publish for the new session).
	 * Background-session rows and the activity log are cross-session state and are kept.
	 */
	resetForegroundSession(): void {
		this.running = false;
		this.retry = undefined;
		this.compaction = undefined;
		this.waiting = undefined;
		this.activeTools.clear();
		this.channels.clear();
		for (const [id, row] of this.agents) {
			if (row.kind === "channel-entry") this.agents.delete(id);
		}
		this.revision += 1;
	}

	recordUiPromptStart(kind: string, title: string | undefined): void {
		this.waiting = { kind, title };
		this.revision += 1;
	}

	recordUiPromptEnd(): void {
		this.waiting = undefined;
		this.revision += 1;
	}

	/**
	 * Counts a pending `custom()` call until the returned release runs. The SDK reports every
	 * outermost `custom()` as a UI prompt, including a long-lived non-capturing overlay (a side
	 * popup the user can stash and bring back) — which leaves the turn "waiting for extension
	 * input" for as long as it lives, even though nothing is waiting on the user. A `custom`
	 * wait therefore only counts while a capturing `custom()` is pending.
	 */
	trackCustomPrompt(capturing: boolean): () => void {
		if (capturing) this.capturingCustoms += 1;
		else this.ambientCustoms += 1;
		this.revision += 1;
		let released = false;
		return () => {
			if (released) return;
			released = true;
			if (capturing) this.capturingCustoms -= 1;
			else this.ambientCustoms -= 1;
			this.revision += 1;
		};
	}

	recordModelSelect(modelId: string, source: string): void {
		this.pushActivity("model", `Model changed to ${modelId} (${source})`, false);
		this.revision += 1;
	}

	recordThinkingSelect(level: string, previousLevel: string): void {
		if (level === previousLevel) return;
		this.pushActivity(
			"model",
			`Thinking level changed from ${previousLevel} to ${level}`,
			false,
		);
		this.revision += 1;
	}

	/**
	 * Records the latest payload published on an extension `pi.events` channel. The payload is
	 * untrusted extension output: it is defensively coerced to JSON and size-capped before it is
	 * ever handed to a renderer (AGENTS.md non-negotiable).
	 */
	recordChannel(channel: string, payload: JsonValue): void {
		const value = asDisplayableJson(payload);
		if (
			!this.channels.has(channel) &&
			this.channels.size >= liveWorkspaceChannelLimit
		) {
			// An extension keying channels by job/request id must not grow this map (and the
			// Extensions tab it renders into) forever: evict the oldest-published channel —
			// `Map` keeps insertion order — along with the agent rows derived from it.
			const oldest = this.channels.keys().next().value;
			if (oldest !== undefined) {
				this.channels.delete(oldest);
				for (const [id, row] of this.agents) {
					if (row.source === oldest) this.agents.delete(id);
				}
			}
		}
		this.channels.set(channel, { channel, payload: value, updatedAt: Date.now() });
		const rows = deriveAgentRows(channel, value);
		const rowIds = new Set(rows.map((row) => row.id));
		for (const [id, row] of this.agents) {
			if (row.source === channel && !rowIds.has(id)) this.agents.delete(id);
		}
		for (const row of rows) this.agents.set(row.id, row);
		this.revision += 1;
	}

	/** Latest payload per extension channel, published into the single `AppStore.extensionChannels`. */
	channelSnapshots(): ExtensionChannelSnapshot[] {
		return [...this.channels.values()];
	}

	clearActivity(): void {
		this.activity = [];
		this.revision += 1;
	}

	snapshot(input: LiveWorkspaceSnapshotInput): LiveWorkspaceSnapshot {
		const activeTools: LiveWorkspaceActiveTool[] = [
			...this.activeTools.entries(),
		].map(([toolCallId, tool]) => ({
			toolCallId,
			toolName: tool.toolName,
			summary: tool.summary,
			startedAt: tool.startedAt,
			preview: tool.preview,
		}));
		const agents = [...this.agents.values()].map((agent) =>
			agent.kind === "background-session"
				? { ...agent, activeToolCount: this.backgroundToolCounts.get(agent.id) }
				: agent,
		);
		return {
			revision: this.revision,
			turn: this.turnState(),
			activeTools,
			queuedSteering: input.queuedSteering,
			queuedFollowUp: input.queuedFollowUp,
			agents,
			activity: [...this.activity].toReversed(),
		};
	}

	private turnState(): LiveWorkspaceTurnState | undefined {
		const ambientCustomOnly =
			this.waiting?.kind === "custom" &&
			this.capturingCustoms === 0 &&
			this.ambientCustoms > 0;
		if (this.waiting && !ambientCustomOnly) {
			return {
				phase: "waiting-for-extension",
				waitingKind: this.waiting.kind,
				waitingTitle: this.waiting.title,
			};
		}
		if (this.compaction) {
			return { phase: "compacting", compactionReason: this.compaction.reason };
		}
		if (this.retry) {
			return {
				phase: "retrying",
				retryAttempt: this.retry.attempt,
				retryMaxAttempts: this.retry.maxAttempts,
				retryAt: this.retry.at,
			};
		}
		if (this.running) return { phase: "running" };
		return undefined;
	}

	private pushActivity(kind: string, text: string, background: boolean): void {
		this.activity.push({
			id: `a${this.nextActivityId++}`,
			at: Date.now(),
			kind,
			text: truncateForDisplay(text, liveWorkspaceActivityTextLimit),
			background,
		});
		if (this.activity.length > liveWorkspaceActivityLimit) {
			this.activity = this.activity.slice(
				this.activity.length - liveWorkspaceActivityLimit,
			);
		}
	}
}

/**
 * A running tool's live output preview. The SDK's `partialResult` is an `AgentToolResult`
 * (`{ content: [{ type: "text", text }], details }`), not a string: show the tail of its
 * text blocks — the newest output is what a "what is it doing now" preview is for —
 * rather than the raw JSON envelope (`{"content":[]}`).
 */
function summarizePartialResult(value: JsonValue | undefined): string | undefined {
	if (value === undefined || value === null) return undefined;
	if (isString(value)) return truncateForDisplay(value, liveWorkspaceToolPreviewLimit);
	const content = asRecord(value)?.content;
	if (Array.isArray(content)) {
		const text = content
			.map((block) => asRecord(block))
			.map((block) =>
				block?.type === "text" && isString(block.text) ? block.text : "",
			)
			.join("");
		if (!text) return undefined;
		return text.length > liveWorkspaceToolPreviewLimit
			? `…${text.slice(-liveWorkspaceToolPreviewLimit)}`
			: text;
	}
	try {
		return truncateForDisplay(JSON.stringify(value), liveWorkspaceToolPreviewLimit);
	} catch {
		return undefined;
	}
}

function asDisplayableJson(payload: JsonValue): JsonValue {
	try {
		const json = JSON.stringify(payload) ?? "null";
		if (json.length > liveWorkspaceChannelJsonLimit) {
			return {
				truncated: true,
				preview: `${json.slice(0, liveWorkspaceChannelJsonLimit)}…`,
			};
		}
		// SAFETY: `json` was just produced by `JSON.stringify`, so parsing it back always
		// yields a JSON-shaped value.
		return JSON.parse(json) as JsonValue;
	} catch {
		return { unrepresentable: true };
	}
}

function deriveAgentRows(channel: string, value: JsonValue): LiveWorkspaceAgentRow[] {
	const record = asRecord(value);
	if (!record) return [];
	if (channel === "subagents:fleet" || channel === "bash-bg:fleet") {
		const entries = Array.isArray(record.entries) ? record.entries : [];
		return entries.slice(0, liveWorkspaceChannelRowLimit).flatMap((entry, index) => {
			const row = asRecord(entry);
			if (!row) return [];
			const key = isString(row.key) ? row.key : `${channel}:${index}`;
			const label = isString(row.name)
				? row.name
				: isString(row.label)
					? row.label
					: key;
			const status = isString(row.state)
				? row.state
				: isString(row.status)
					? row.status
					: "unknown";
			return [
				{
					id: `${channel}:${key}`,
					kind: "channel-entry" as const,
					source: channel,
					label,
					detail: isString(row.model) ? row.model : undefined,
					status,
					depth: isNumber(row.depth) ? row.depth : 0,
					tokens: isNumber(row.tokens) ? row.tokens : undefined,
				},
			];
		});
	}
	if (channel === "workflow:progress" || channel === "pi-goal:status") {
		if (record.active === false) return [];
		const label = isString(record.name)
			? record.name
			: isString(record.text)
				? record.text
				: channel;
		const status = isString(record.phase)
			? record.phase
			: isString(record.status)
				? record.status
				: "active";
		// `WorkflowStatusPayload` (see the `workflows` extension) carries `done`/`total`
		// agent counts alongside the phase name; fold them into `detail` when present so
		// the Agents tab row reads e.g. "running (2/5 agents)" instead of just the phase.
		const detail = isString(record.detail)
			? record.detail
			: isNumber(record.done) && isNumber(record.total)
				? `${record.done}/${record.total} agent${record.total === 1 ? "" : "s"}`
				: undefined;
		return [
			{
				id: channel,
				kind: "channel-entry" as const,
				source: channel,
				label,
				detail,
				status,
				depth: 0,
				startedAt: isNumber(record.startedAt) ? record.startedAt : undefined,
			},
		];
	}
	return [];
}

function errorText(cause: unknown): string {
	return cause instanceof Error ? cause.message : String(cause);
}
