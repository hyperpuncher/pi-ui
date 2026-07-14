import type {
	AgentSessionRuntime,
	SessionTreeNode,
} from "@earendil-works/pi-coding-agent";
import { assertEquals, assertStringIncludes } from "@std/assert";

import { AppStore } from "../state/app-store.ts";
import {
	modelMatchesPattern,
	parseScopedModelPattern,
	resolveScopedModels,
} from "./model-controller.ts";
import {
	formatSessionSummary,
	type PreparedSessionList,
	recentSessionWorkspaces,
	SessionCatalog,
} from "./session-catalog.ts";
import {
	contentToText,
	formatShellCommandDisplay,
	formatToolResult,
	formatToolStart,
	summarizeValue,
	toolTitleParts,
} from "./tool-presentation.ts";
import {
	assistantContentToMessages,
	userContentToMessages,
} from "./transcript-projector.ts";
import { flattenTree, TreeProjector } from "./tree-projector.ts";
import { formatStats, formatTokens } from "./usage-controller.ts";

Deno.test("tool presentation preserves representative and malformed values", () => {
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
	const circular: Record<string, unknown> = {};
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
	const entry = (id: string, parentId: string | null, text: string) => ({
		id,
		parentId,
		timestamp: "2026-01-01T00:00:00.000Z",
		type: "message",
		message: { role: "user", content: text },
	});
	const roots = [
		{
			entry: entry("root", null, "root"),
			children: [
				{ entry: entry("inactive", "root", "inactive"), children: [] },
				{ entry: entry("active", "root", "active"), children: [] },
			],
		},
	] as unknown as SessionTreeNode[];
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
	const runtime = {
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
	} as unknown as AgentSessionRuntime;
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
	const runtime = { session } as unknown as AgentSessionRuntime;
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
	const runtime = {
		session: {
			navigateTree: async () => ({ cancelled: false, editorText: undefined }),
			sessionManager: {
				getTree: () => [],
				getLeafId: () => null,
				getBranch: () => [],
			},
		},
	} as unknown as AgentSessionRuntime;
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

Deno.test("session catalog ignores an older refresh that finishes last", async () => {
	const state = new AppStore();
	const catalog = new SessionCatalog(state, (sessions) => [...sessions]);
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

Deno.test("catalog and usage formatting remain stable", () => {
	const sessions = [
		{
			path: "/one",
			cwd: "/work/a",
			name: "Named",
			firstMessage: "first",
			messageCount: 1,
			modified: new Date(0),
		},
		{
			path: "/two",
			cwd: "/work/a",
			name: "",
			firstMessage: "second",
			messageCount: 2,
			modified: new Date(0),
		},
	] as Parameters<typeof recentSessionWorkspaces>[0];
	assertEquals(recentSessionWorkspaces(sessions), ["/work/a"]);
	const summary = formatSessionSummary(sessions[0]);
	assertEquals(
		{ title: summary.title, subtitle: summary.subtitle },
		{
			title: "Named",
			subtitle: "1 message • /work/a",
		},
	);
	assertEquals(formatTokens(1_250), "1.3k");
	assertEquals(
		formatStats({
			cost: 0.125,
			tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 1_250 },
			contextUsage: null,
		} as unknown as Parameters<typeof formatStats>[0]),
		{
			text: "$0.125 • 1.3k tokens",
			codexText: undefined,
			codexPrimaryPercent: undefined,
			codexSecondaryPercent: undefined,
		},
	);
});
