import { test } from "bun:test";

import { assertEquals, assertExists, assertStringIncludes } from "#testing/assertions";

import type { JsonValue } from "../utils/json-types.ts";
import { LiveWorkspaceController } from "./live-workspace-controller.ts";
import { agentSessionEventStub } from "./test-fixtures.ts";

function fixture() {
	const controller = new LiveWorkspaceController();
	const input = { queuedSteering: 0, queuedFollowUp: 0 };
	return { controller, input };
}

test("tracks the foreground turn phase across the run lifecycle", () => {
	const { controller, input } = fixture();

	assertEquals(controller.snapshot(input).turn, undefined);

	controller.recordEvent(agentSessionEventStub({ type: "agent_start" }), {
		background: false,
	});
	assertEquals(controller.snapshot(input).turn, { phase: "running" });

	controller.recordEvent(
		agentSessionEventStub({
			type: "auto_retry_start",
			attempt: 1,
			maxAttempts: 3,
			delayMs: 500,
			errorMessage: "rate limited",
		}),
		{ background: false },
	);
	const retrying = controller.snapshot(input).turn;
	assertEquals(retrying?.phase, "retrying");
	assertEquals(retrying?.retryAttempt, 1);
	assertEquals(retrying?.retryMaxAttempts, 3);

	controller.recordEvent(
		agentSessionEventStub({ type: "auto_retry_end", success: true, attempt: 1 }),
		{ background: false },
	);
	assertEquals(controller.snapshot(input).turn, { phase: "running" });

	controller.recordEvent(
		agentSessionEventStub({ type: "compaction_start", reason: "threshold" }),
		{ background: false },
	);
	assertEquals(controller.snapshot(input).turn, {
		phase: "compacting",
		compactionReason: "threshold",
	});

	controller.recordEvent(
		agentSessionEventStub({
			type: "compaction_end",
			reason: "threshold",
			result: undefined,
			aborted: false,
			willRetry: false,
		}),
		{ background: false },
	);
	assertEquals(controller.snapshot(input).turn, { phase: "running" });

	controller.recordEvent(agentSessionEventStub({ type: "agent_settled" }), {
		background: false,
	});
	assertEquals(controller.snapshot(input).turn, undefined);
});

test("waiting-for-extension-UI phase takes priority and clears on prompt end", () => {
	const { controller, input } = fixture();
	controller.recordEvent(agentSessionEventStub({ type: "agent_start" }), {
		background: false,
	});

	controller.recordUiPromptStart("select", "Pick an option");
	const waiting = controller.snapshot(input).turn;
	assertEquals(waiting, {
		phase: "waiting-for-extension",
		waitingKind: "select",
		waitingTitle: "Pick an option",
	});

	controller.recordUiPromptEnd();
	assertEquals(controller.snapshot(input).turn, { phase: "running" });
});

test("a non-capturing custom() overlay alone does not count as waiting for input", () => {
	const { controller, input } = fixture();
	const releaseAmbient = controller.trackCustomPrompt(false);
	controller.recordUiPromptStart("custom", undefined);
	assertEquals(controller.snapshot(input).turn, undefined);

	// A capturing custom() (inline, or a focus-taking overlay) is a real wait.
	const releaseCapturing = controller.trackCustomPrompt(true);
	assertEquals(controller.snapshot(input).turn, {
		phase: "waiting-for-extension",
		waitingKind: "custom",
		waitingTitle: undefined,
	});
	releaseCapturing();
	releaseCapturing();
	assertEquals(controller.snapshot(input).turn, undefined);

	releaseAmbient();
	controller.recordUiPromptEnd();
	assertEquals(controller.snapshot(input).turn, undefined);
});

test("tracks active tools with a human-readable summary and clears on completion", () => {
	const { controller, input } = fixture();

	controller.recordEvent(
		agentSessionEventStub({
			type: "tool_execution_start",
			toolCallId: "call-1",
			toolName: "bash",
			args: { command: "echo hi" },
		}),
		{ background: false },
	);
	const [tool] = controller.snapshot(input).activeTools;
	assertExists(tool);
	assertEquals(tool.toolCallId, "call-1");
	assertEquals(tool.toolName, "bash");
	assertStringIncludes(tool.summary ?? "", "echo hi");

	controller.recordEvent(
		agentSessionEventStub({
			type: "tool_execution_update",
			toolCallId: "call-1",
			toolName: "bash",
			args: { command: "echo hi" },
			partialResult: "hi\n",
		}),
		{ background: false },
	);
	assertEquals(controller.snapshot(input).activeTools[0]?.preview, "hi\n");

	controller.recordEvent(
		agentSessionEventStub({
			type: "tool_execution_end",
			toolCallId: "call-1",
			toolName: "bash",
			result: "hi\n",
			isError: false,
		}),
		{ background: false },
	);
	assertEquals(controller.snapshot(input).activeTools, []);
});

test("agent_settled clears any active tools left running by an aborted turn", () => {
	const { controller, input } = fixture();
	controller.recordEvent(
		agentSessionEventStub({
			type: "tool_execution_start",
			toolCallId: "call-1",
			toolName: "bash",
			args: { command: "sleep 5" },
		}),
		{ background: false },
	);
	assertEquals(controller.snapshot(input).activeTools.length, 1);

	controller.recordEvent(agentSessionEventStub({ type: "agent_settled" }), {
		background: false,
	});
	assertEquals(controller.snapshot(input).activeTools, []);
});

test("derives a workflow done/total detail from workflow:progress", () => {
	const { controller, input } = fixture();
	controller.recordChannel("workflow:progress", {
		active: true,
		name: "Refactor",
		phase: "running",
		done: 2,
		total: 5,
	});
	const [row] = controller.snapshot(input).agents;
	assertEquals(row?.detail, "2/5 agents");
});

test("records a bounded, most-recent-first activity log", () => {
	const { controller, input } = fixture();

	controller.recordEvent(
		agentSessionEventStub({
			type: "auto_retry_start",
			attempt: 1,
			maxAttempts: 2,
			delayMs: 100,
			errorMessage: "boom",
		}),
		{ background: false },
	);
	controller.recordEvent(
		agentSessionEventStub({
			type: "compaction_start",
			reason: "manual",
		}),
		{ background: false },
	);

	const activity = controller.snapshot(input).activity;
	assertEquals(activity.length, 2);
	// Most recent entry (compaction) comes first.
	assertStringIncludes(activity[0]?.text ?? "", "Compacting");
	assertStringIncludes(activity[1]?.text ?? "", "Retrying");

	controller.clearActivity();
	assertEquals(controller.snapshot(input).activity, []);
});

test("derives a subagent fleet roster from a channel payload and clears stale rows", () => {
	const { controller, input } = fixture();

	controller.recordChannel("subagents:fleet", {
		entries: [
			{
				key: "worker-1",
				name: "Worker 1",
				state: "running",
				depth: 1,
				tokens: 120,
			},
			{ key: "worker-2", name: "Worker 2", state: "idle", depth: 1 },
		],
	});
	let agents = controller.snapshot(input).agents;
	assertEquals(agents.length, 2);
	assertEquals(agents[0]?.label, "Worker 1");
	assertEquals(agents[0]?.status, "running");
	assertEquals(agents[0]?.tokens, 120);

	controller.recordChannel("subagents:fleet", {
		entries: [{ key: "worker-1", name: "Worker 1", state: "running", depth: 1 }],
	});
	agents = controller.snapshot(input).agents;
	assertEquals(agents.length, 1);
	assertEquals(agents[0]?.id, "subagents:fleet:worker-1");
});

test("derives a single-status row from workflow:progress and clears it when inactive", () => {
	const { controller, input } = fixture();

	controller.recordChannel("workflow:progress", {
		active: true,
		name: "Refactor",
		phase: "running",
	});
	assertEquals(controller.snapshot(input).agents.length, 1);

	controller.recordChannel("workflow:progress", { active: false });
	assertEquals(controller.snapshot(input).agents, []);
});

test("tracks background sessions and their in-flight tool counts independently of the foreground", () => {
	const { controller, input } = fixture();

	controller.setBackgroundSession("session.jsonl", "running", "~/project", 1000);
	let agents = controller.snapshot(input).agents;
	assertEquals(agents.length, 1);
	assertEquals(agents[0]?.kind, "background-session");
	assertEquals(agents[0]?.activeToolCount, undefined);

	controller.recordEvent(
		agentSessionEventStub({
			type: "tool_execution_start",
			toolCallId: "bg-1",
			toolName: "read",
			args: {},
		}),
		{ background: true, sessionPath: "session.jsonl" },
	);
	agents = controller.snapshot(input).agents;
	assertEquals(agents[0]?.activeToolCount, 1);
	// Background tool activity must never populate the foreground active-tools list.
	assertEquals(controller.snapshot(input).activeTools, []);

	controller.removeBackgroundSession("session.jsonl");
	assertEquals(controller.snapshot(input).agents, []);
});

test("never throws on a malformed extension channel payload", () => {
	const { controller, input } = fixture();

	controller.recordChannel("subagents:fleet", { entries: "not-an-array" });
	assertEquals(controller.snapshot(input).agents, []);

	type CircularHolder = { self?: CircularHolder };
	const circular: CircularHolder = {};
	circular.self = circular;
	controller.recordChannel("subagents:fleet", circular as unknown as JsonValue);
	assertEquals(controller.channelSnapshots().at(-1)?.payload, {
		unrepresentable: true,
	});
});

test("only bumps the revision when an event changes tracked state", () => {
	const { controller, input } = fixture();
	const before = controller.snapshot(input).revision;

	const changed = controller.recordEvent(
		agentSessionEventStub({ type: "message_update" }),
		{ background: false },
	);
	assertEquals(changed, false);
	assertEquals(controller.snapshot(input).revision, before);

	assertEquals(
		controller.recordEvent(agentSessionEventStub({ type: "agent_start" }), {
			background: false,
		}),
		true,
	);
	assertEquals(controller.snapshot(input).revision, before + 1);
});

test("a tool's live preview shows the tail of its partial result text, not the raw result JSON", () => {
	const { controller, input } = fixture();
	controller.recordEvent(
		agentSessionEventStub({
			type: "tool_execution_start",
			toolCallId: "t1",
			toolName: "bash",
			args: { command: "build" },
		}),
		{ background: false },
	);
	const update = (partialResult: unknown) =>
		controller.recordEvent(
			agentSessionEventStub({
				type: "tool_execution_update",
				toolCallId: "t1",
				toolName: "bash",
				args: {},
				partialResult,
			}),
			{ background: false },
		);
	update({ content: [] });
	assertEquals(controller.snapshot(input).activeTools[0]?.preview, undefined);
	update({ content: [{ type: "text", text: "step 1\n" }], details: {} });
	assertEquals(controller.snapshot(input).activeTools[0]?.preview, "step 1\n");
	update({ content: [{ type: "text", text: `${"x".repeat(500)}LAST` }] });
	const preview = controller.snapshot(input).activeTools[0]?.preview ?? "";
	assertStringIncludes(preview, "LAST");
	assertEquals(preview.startsWith("…"), true);
});

test("an unchanged streaming tool preview does not count as a change", () => {
	const { controller } = fixture();
	controller.recordEvent(
		agentSessionEventStub({
			type: "tool_execution_start",
			toolCallId: "t1",
			toolName: "bash",
			args: {},
		}),
		{ background: false },
	);
	const update = agentSessionEventStub({
		type: "tool_execution_update",
		toolCallId: "t1",
		toolName: "bash",
		args: {},
		partialResult: "line 1",
	});
	assertEquals(controller.recordEvent(update, { background: false }), true);
	assertEquals(controller.recordEvent(update, { background: false }), false);
});

test("a foreground session switch clears channels and channel-derived rows but keeps background sessions", () => {
	const { controller, input } = fixture();
	controller.setBackgroundSession("bg.jsonl", "running", "~/bg", 1);
	controller.recordChannel("workflow:progress", { active: true, name: "Plan" });
	assertEquals(controller.snapshot(input).agents.length, 2);

	controller.resetForegroundSession();
	assertEquals(controller.channelSnapshots(), []);
	assertEquals(
		controller.snapshot(input).agents.map((agent) => agent.kind),
		["background-session"],
	);
});

test("passes through the caller-supplied queued message counts", () => {
	const { controller } = fixture();
	const snapshot = controller.snapshot({ queuedSteering: 2, queuedFollowUp: 1 });
	assertEquals(snapshot.queuedSteering, 2);
	assertEquals(snapshot.queuedFollowUp, 1);
});

test("caps distinct extension channels, evicting the oldest along with its agent rows", () => {
	const { controller, input } = fixture();
	controller.recordChannel("subagents:fleet", {
		entries: [{ key: "a1", name: "scout", state: "running", depth: 1 }],
	});
	const fleetRows = controller.snapshot(input).agents.length;
	for (let index = 0; index < 80; index += 1) {
		controller.recordChannel(`job:${index}`, { index });
	}
	const channels = controller.channelSnapshots().map((entry) => entry.channel);
	assertEquals(channels.length, 64);
	// The first channel published was evicted first, and its derived rows went with it.
	assertEquals(channels.includes("subagents:fleet"), false);
	assertEquals(channels.includes("job:79"), true);
	assertEquals(channels.includes("job:15"), false);
	assertEquals(
		controller.snapshot(input).agents.some((row) => row.source === "subagents:fleet"),
		false,
	);
	assertEquals(fleetRows > 0, true);
});
