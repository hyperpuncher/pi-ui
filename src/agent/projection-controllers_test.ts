import os from "node:os";

import type { SessionTreeNode } from "@earendil-works/pi-coding-agent";
import { assertEquals, assertStrictEquals, assertStringIncludes } from "@std/assert";

import { AppStore } from "../state/app-store.ts";
import { formatTokens } from "../utils/format.ts";
import {
	modelMatchesPattern,
	parseScopedModelPattern,
	resolveScopedModels,
} from "./model-controller.ts";
import {
	formatSessionSummary,
	listCachedSessions,
	type PreparedSessionList,
	recentSessionWorkspaces,
	SessionCatalog,
} from "./session-catalog.ts";
import {
	agentSessionEventStub,
	agentSessionRuntimeStub,
	sessionEntryStub,
	sessionStatsStub,
} from "./test-fixtures.ts";
import {
	contentToText,
	formatShellCommandDisplay,
	formatToolResult,
	formatToolStart,
	summarizeValue,
	toolEndMeta,
	toolTitleParts,
} from "./tool-presentation.ts";
import {
	assistantContentToMessages,
	TranscriptProjector,
	userContentToMessages,
} from "./transcript-projector.ts";
import { flattenTree, TreeProjector } from "./tree-projector.ts";
import { formatStats } from "./usage-controller.ts";

Deno.test("tool presentation preserves representative and malformed values", () => {
	assertEquals(toolEndMeta(Date.now() - 90_000), "1m 30s");
	assertEquals(formatToolStart("edit", { edits: [{}, {}] }), {
		text: "2 replacements",
		format: "output",
	});
	assertEquals(formatToolResult("edit", { details: { patch: "@@ -1 +1 @@" } }), {
		text: "@@ -1 +1 @@",
		format: "diff",
	});
	assertEquals(formatToolResult("edit", "oldText must be unique", { isError: true }), {
		text: "oldText must be unique",
		format: "output",
	});
	assertEquals(
		formatToolResult(
			"bash",
			{ content: [{ type: "text", text: "a\nb\n" }] },
			{
				args: { command: "rg pattern" },
			},
		),
		{ text: "2 results", format: "output" },
	);
	assertEquals(toolTitleParts("read", { path: "/tmp/file", offset: 3, limit: 2 }), [
		{ text: "read" },
		{ text: "/tmp/file", tone: "accent", mono: true },
		{ text: ":3-4", tone: "warning", mono: true },
	]);
	assertStringIncludes(
		formatShellCommandDisplay(`echo ${"x".repeat(90)} && done`),
		"&&\ndone",
	);
	assertStringIncludes(
		formatShellCommandDisplay(`echo ${"x".repeat(90)}; done`),
		";\ndone",
	);
	assertStringIncludes(
		formatShellCommandDisplay(`echo ${"x".repeat(90)} |& tee out`),
		" |&\ntee out",
	);
	assertStringIncludes(
		formatShellCommandDisplay(`case ${"x".repeat(90)} in x) one ;;& y) two ;& esac`),
		"one;;&\ny) two;&\nesac",
	);
	assertStringIncludes(
		formatShellCommandDisplay(`echo ${"x".repeat(90)} # keep ; | && unchanged`),
		"# keep ; | && unchanged",
	);
	assertEquals(
		contentToText([
			{ type: "thinking", thinking: "hidden" },
			{ type: "image", mimeType: "image/png" },
		]),
		"[image: image/png]",
	);
	type CircularToolValue = { self?: object };
	const circular: CircularToolValue = {};
	circular.self = circular;
	assertEquals(summarizeValue(circular), "[object Object]");
});

Deno.test("transcript projection preserves user, skill, thought, and assistant roles", () => {
	const timestamp = new Date(0);
	assertEquals(userContentToMessages("hello", timestamp), [
		{ role: "user", text: "hello", timestamp },
	]);
	const assistant = assistantContentToMessages(
		[
			{ type: "thinking", thinking: "reason" },
			{ type: "text", text: "answer\u001b[31m" },
		],
		timestamp,
	);
	assertEquals(
		assistant.map(({ role, text }) => ({ role, text })),
		[
			{ role: "thought", text: "reason" },
			{ role: "assistant", text: "answer" },
		],
	);
});

Deno.test("user projection keeps image data and hides transfer implementation text", () => {
	const [message] = new TranscriptProjector().message(
		{
			role: "user",
			content: [
				{
					type: "text",
					text: "@/tmp/pi-ui-transfers-id/file-a1b2-image.png\n@/tmp/pi-ui-transfers-id/file-c3d4-notes.txt\ncheck this",
				},
				{ type: "image", data: "aW1hZ2U=", mimeType: "image/png" },
			],
			timestamp: 0,
		},
		new Date(0),
	);
	assertEquals(message, {
		role: "user",
		text: "check this",
		timestamp: new Date(0),
		attachments: [
			{
				name: "image.png",
				path: "/tmp/pi-ui-transfers-id/file-a1b2-image.png",
				mimeType: "image/png",
				image: { data: "aW1hZ2U=", mimeType: "image/png" },
			},
			{
				name: "notes.txt",
				path: "/tmp/pi-ui-transfers-id/file-c3d4-notes.txt",
				mimeType: "text/plain",
			},
		],
	});
});

Deno.test("model patterns preserve wildcards, thinking suffixes, and first-match ordering", () => {
	const models = [
		{ provider: "openai", id: "gpt-5", name: "GPT Five" },
		{ provider: "anthropic", id: "claude-sonnet", name: "Sonnet" },
	];
	assertEquals(parseScopedModelPattern("openai/*:high"), {
		modelPattern: "openai/*",
		thinkingLevel: "high",
	});
	assertEquals(modelMatchesPattern(models[1], "*sonnet"), true);
	assertEquals(resolveScopedModels(["*sonnet:medium", "openai/*", "*sonnet"], models), [
		{ model: models[1], thinkingLevel: "medium" },
		{ model: models[0], thinkingLevel: undefined },
	]);
});

Deno.test("tree projection orders the active branch first", () => {
	const entry = (id: string, parentId: string | null, text: string) =>
		sessionEntryStub({
			id,
			parentId,
			timestamp: "2026-01-01T00:00:00.000Z",
			type: "message",
			message: { role: "user", content: text },
		});
	const roots: SessionTreeNode[] = [
		{
			entry: entry("root", null, "root"),
			children: [
				{ entry: entry("inactive", "root", "inactive"), children: [] },
				{ entry: entry("active", "root", "active"), children: [] },
			],
		},
	];
	const rows = flattenTree(roots, "active", new Set(["root", "active"]));
	assertEquals(
		rows.map((row) => row.id),
		["root", "active", "inactive"],
	);
	assertEquals(rows[1].active, true);
	assertEquals(rows[1].prefix, "├─ ");
});

Deno.test("tree navigation rejects overlap and can cancel summarization", async () => {
	let navigateCount = 0;
	let abortCount = 0;
	let finishNavigation = (_result: { cancelled: boolean }) => {};
	const navigation = new Promise<{ cancelled: boolean }>((resolve) => {
		finishNavigation = resolve;
	});
	const runtime = agentSessionRuntimeStub({
		session: {
			navigateTree: () => {
				navigateCount += 1;
				return navigation;
			},
			abortBranchSummary: () => {
				abortCount += 1;
				finishNavigation({ cancelled: true });
			},
			sessionManager: {
				getTree: () => [],
				getLeafId: () => null,
				getBranch: () => [],
			},
		},
	});
	const projector = new TreeProjector(() => runtime, {
		setTreeEntries: () => {},
	});

	const first = projector.navigate("one", { summarize: true });
	assertEquals(await projector.navigate("two"), { status: "busy" });
	projector.open();
	assertEquals(await first, { status: "cancelled" });
	assertEquals({ navigateCount, abortCount }, { navigateCount: 1, abortCount: 1 });
});

Deno.test("stale tree navigation cannot mutate a reused session generation", async () => {
	let finishOld = (_result: { cancelled: boolean; editorText: string }) => {};
	const oldNavigation = new Promise<{ cancelled: boolean; editorText: string }>(
		(resolve) => (finishOld = resolve),
	);
	let navigateCount = 0;
	const session = {
		navigateTree: () => {
			navigateCount += 1;
			return navigateCount === 1
				? oldNavigation
				: Promise.resolve({ cancelled: false, editorText: "new" });
		},
		abortBranchSummary: () => {},
		sessionManager: {
			getTree: () => [],
			getLeafId: () => null,
			getBranch: () => [],
		},
	};
	const runtime = agentSessionRuntimeStub({ session });
	let generation = 1;
	let navigated = 0;
	let treeLoads = 0;
	const projector = new TreeProjector(
		() => runtime,
		{ setTreeEntries: () => (treeLoads += 1) },
		() => (navigated += 1),
		() => generation,
	);

	const old = projector.navigate("old");
	generation += 1;
	assertEquals(await projector.navigate("new"), {
		status: "success",
		editorText: "new",
	});
	finishOld({ cancelled: false, editorText: "stale" });
	assertEquals(await old, { status: "cancelled" });
	assertEquals({ navigated, treeLoads }, { navigated: 1, treeLoads: 1 });
});

Deno.test("tree navigation reports successful empty editor text explicitly", async () => {
	let navigated = 0;
	const runtime = agentSessionRuntimeStub({
		session: {
			navigateTree: async () => ({ cancelled: false, editorText: undefined }),
			sessionManager: {
				getTree: () => [],
				getLeafId: () => null,
				getBranch: () => [],
			},
		},
	});
	const projector = new TreeProjector(
		() => runtime,
		{ setTreeEntries: () => {} },
		() => (navigated += 1),
	);

	assertEquals(await projector.navigate("one"), {
		status: "success",
		editorText: undefined,
	});
	assertEquals(navigated, 1);
});

Deno.test("session discovery indexes every candidate in newest-first order", async () => {
	const root = await Deno.makeTempDir();
	try {
		const workspace = `${root}/workspace`;
		await Deno.mkdir(workspace);
		for (let index = 1; index <= 4; index++) {
			const timestamp = new Date(index * 1_000);
			const path = `${workspace}/${index}.jsonl`;
			await Deno.writeTextFile(
				path,
				`${JSON.stringify({
					type: "session",
					version: 3,
					id: `session-${index}`,
					timestamp: timestamp.toISOString(),
					cwd: `/workspace-${index}`,
				})}\n${JSON.stringify({
					type: "message",
					id: `message-${index}`,
					parentId: null,
					timestamp: timestamp.toISOString(),
					message: {
						role: "user",
						content: `Message ${index}`,
						timestamp: timestamp.getTime(),
					},
				})}\n`,
			);
			await Deno.utime(path, timestamp, timestamp);
		}

		const sessions = await listCachedSessions(root, `${root}/session-index.json`);
		assertEquals(
			sessions.map((session) => session.id),
			["session-4", "session-3", "session-2", "session-1"],
		);
		assertEquals(sessions[0]?.firstMessage, "Message 4");
	} finally {
		await Deno.remove(root, { recursive: true });
	}
});

Deno.test("session catalog ignores an older refresh that finishes last", async () => {
	const state = new AppStore();
	const catalog = new SessionCatalog(state);
	let finishOlder = (_value: PreparedSessionList) => {};
	const older = catalog.refresh(
		() =>
			new Promise<PreparedSessionList>((resolve) => {
				finishOlder = resolve;
			}),
	);
	const newer = catalog.refresh(() =>
		Promise.resolve({ ok: true, sessions: [sessionInfo("/new", "New")] }),
	);
	await newer;
	finishOlder({ ok: true, sessions: [sessionInfo("/old", "Old")] });
	await older;

	assertEquals(
		state.sessions.map((session) => session.path),
		["/new"],
	);
});

function sessionInfo(
	path: string,
	name: string,
): Parameters<typeof formatSessionSummary>[0] {
	return {
		id: path,
		path,
		cwd: "/work",
		name,
		firstMessage: name,
		allMessagesText: name,
		messageCount: 1,
		created: new Date(0),
		modified: new Date(0),
	};
}

Deno.test("session catalog updates a streaming session incrementally", () => {
	const state = new AppStore();
	const catalog = new SessionCatalog(state);
	const empty = sessionInfo("/session", "Untitled session");
	empty.messageCount = 0;
	catalog.applyPrepared({ ok: true, sessions: [empty] });

	catalog.handleEvent(
		"/session",
		agentSessionEventStub({
			type: "message_start",
			message: { role: "user", content: "A newly submitted prompt" },
		}),
	);
	catalog.handleEvent(
		"/session",
		agentSessionEventStub({
			type: "message_update",
			message: { role: "assistant", content: [] },
			assistantMessageEvent: undefined,
		}),
	);

	assertEquals(state.sessions[0]?.title, "A newly submitted prompt");
	assertEquals(state.sessions[0]?.subtitle, "1 message");
});

Deno.test("session catalog promotes user-relevant activity", () => {
	const state = new AppStore();
	const catalog = new SessionCatalog(state);
	catalog.applyPrepared({
		ok: true,
		sessions: [sessionInfo("/first", "First"), sessionInfo("/second", "Second")],
	});

	catalog.messageStarted("/second");
	catalog.touch("/second");
	assertEquals(
		state.sessions.map((session) => session.path),
		["/first", "/second"],
	);

	catalog.messageStarted("/second", "Continue this session");
	assertEquals(
		state.sessions.map((session) => session.path),
		["/second", "/first"],
	);

	catalog.agentCompleted("/first");
	assertEquals(
		state.sessions.map((session) => session.path),
		["/first", "/second"],
	);
});

Deno.test("session catalog status changes preserve live row order", () => {
	const state = new AppStore();
	const statuses = new Map<string, "running" | "completed">();
	const catalog = new SessionCatalog(state, {
		agentDir: "",
		backgroundStatuses: () => statuses,
	});
	catalog.applyPrepared({
		ok: true,
		sessions: [
			sessionInfo("/first", "First"),
			sessionInfo("/second", "Second"),
			sessionInfo("/third", "Third"),
		],
	});

	const unchangedCatalog = state.getSessionCatalog();
	catalog.mergeCurrentStatuses();
	assertStrictEquals(state.getSessionCatalog(), unchangedCatalog);

	statuses.set("/third", "completed");
	catalog.mergeCurrentStatuses();
	catalog.touch("/second");
	assertEquals(
		state.sessions.map((session) => session.path),
		["/first", "/second", "/third"],
	);

	statuses.set("/second", "completed");
	catalog.mergeCurrentStatuses();
	statuses.delete("/second");
	catalog.mergeCurrentStatuses();
	statuses.delete("/third");
	catalog.mergeCurrentStatuses();
	assertEquals(
		state.sessions.map((session) => session.path),
		["/first", "/second", "/third"],
	);
});

Deno.test("session catalog owns watcher activation and cleanup", () => {
	const state = new AppStore();
	let watchCount = 0;
	let stopCount = 0;
	let changed = (_path: string) => {};
	const catalog = new SessionCatalog(state, {
		agentDir: "/agent",
		watch: (_agentDir, onChange) => {
			watchCount += 1;
			changed = onChange;
			return () => {
				stopCount += 1;
			};
		},
	});

	catalog.activate();
	catalog.activate();
	changed("/agent/sessions/session.jsonl");
	catalog.dispose();
	catalog.dispose();

	assertEquals(watchCount, 1);
	assertEquals(stopCount, 1);
});

Deno.test("session catalog keeps every recent workspace", () => {
	const state = new AppStore();
	const catalog = new SessionCatalog(state);
	const sessions = Array.from({ length: 12 }, (_, index) => {
		const session = sessionInfo(`/session-${index}`, `Session ${index}`);
		session.cwd = `/work/project-${index}`;
		return session;
	});

	catalog.applyPrepared({ ok: true, sessions });

	assertEquals(
		state.recentWorkspaces.filter((workspace) =>
			workspace.startsWith("/work/project-"),
		),
		sessions.map((session) => session.cwd),
	);
});

Deno.test("session catalog keeps recent rows small while searching every session", () => {
	const state = new AppStore();
	const catalog = new SessionCatalog(state);
	const sessions = Array.from({ length: 51 }, (_, index) =>
		sessionInfo(`/session-${index}`, `Session ${index}`),
	);

	catalog.applyPrepared({ ok: true, sessions });

	assertEquals(state.sessions.length, 50);
	assertEquals(
		state.searchSessions("Session 50").map((session) => session.path),
		["/session-50"],
	);
	assertEquals(state.searchSessions("Session").length, 50);
});

Deno.test("session summaries keep workspace and message metadata separate", () => {
	const info = sessionInfo("/session", "Home session");
	info.cwd = `${os.homedir()}/projects/pi-ui`;

	const summary = formatSessionSummary(info);
	assertEquals(summary.cwd, info.cwd);
	assertEquals(summary.subtitle, "1 message");
});

Deno.test("catalog and usage formatting remain stable", () => {
	const sessions: Parameters<typeof recentSessionWorkspaces>[0] = [
		{
			...sessionInfo("/one", "first"),
			cwd: "/work/a",
			name: "Named",
		},
		{
			...sessionInfo("/two", "second"),
			cwd: "/work/a",
			name: "",
			messageCount: 2,
		},
	];
	assertEquals(recentSessionWorkspaces(sessions), ["/work/a"]);
	const summary = formatSessionSummary(sessions[0]);
	assertEquals(
		{ title: summary.title, subtitle: summary.subtitle },
		{
			title: "Named",
			subtitle: "1 message",
		},
	);
	assertEquals(formatTokens(1_250), "1.3k");
	assertEquals(
		formatStats(
			sessionStatsStub({
				cost: 0.125,
				tokens: {
					input: 0,
					output: 0,
					cacheRead: 0,
					cacheWrite: 0,
					total: 1_250,
				},
				contextUsage: undefined,
			}),
		),
		{
			text: "$0.125 • 1.3k tokens",
			costText: "$0.125",
			cacheHitPercent: undefined,
			limits: undefined,
		},
	);
});
