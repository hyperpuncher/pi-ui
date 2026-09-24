import { test } from "bun:test";

import { assertEquals } from "#testing/assertions";

import { toolTitle } from "./tool-presentation.ts";

// toolTitle() = "<toolName> <target>" for tools with a target, else just "<toolName>". These
// pin down the extensionToolTargets table (tool-presentation.ts) so the generic, declarative
// presentation for subagent_*, ask_user, jev_decompose, advisor, todo, goal_*, delegate*,
// memory_*, the web tools, and mcp__* doesn't silently regress to the bare tool name.

test("ask_user shows its question as the target", () => {
	assertEquals(
		toolTitle("running", "ask_user", { question: "Which package manager?" }),
		"ask_user Which package manager?",
	);
});

test("subagent_start shows how many tasks it launched", () => {
	assertEquals(
		toolTitle("running", "subagent_start", { tasks: ["a", "b", "c"] }),
		"subagent_start 3 tasks",
	);
});

test("other subagent_* tools show the referenced id", () => {
	assertEquals(
		toolTitle("running", "subagent_status", { id: "job-42" }),
		"subagent_status job-42",
	);
});

test("jev_decompose shows how many workstreams it produced", () => {
	assertEquals(
		toolTitle("running", "jev_decompose", { workstreams: ["r1", "r2"] }),
		"jev_decompose 2 workstreams",
	);
});

test("advisor falls back through its arg-key list in order", () => {
	assertEquals(
		toolTitle("running", "advisor", { purpose: "review the auth flow" }),
		"advisor review the auth flow",
	);
	assertEquals(
		toolTitle("running", "advisor", { request: "req", purpose: "purpose" }),
		"advisor req",
	);
});

test("todo shows its subject", () => {
	assertEquals(
		toolTitle("running", "todo", { action: "add", subject: "ship it" }),
		"todo add",
	);
});

test("goal_* tools match the prefix", () => {
	assertEquals(
		toolTitle("running", "goal_set", { objective: "ship R2-D" }),
		"goal_set ship R2-D",
	);
});

test("delegate* matches case-insensitively", () => {
	assertEquals(
		toolTitle("running", "delegateTask", { task: "write tests" }),
		"delegateTask write tests",
	);
});

test("memory_* tools show the key or query", () => {
	assertEquals(
		toolTitle("running", "memory_get", { key: "session-notes" }),
		"memory_get session-notes",
	);
});

test("web tools show the query or url", () => {
	assertEquals(
		toolTitle("running", "web_search", { query: "bun jsx tsconfig" }),
		"web_search bun jsx tsconfig",
	);
	assertEquals(
		toolTitle("running", "fetch_content", { url: "https://example.com" }),
		"fetch_content https://example.com",
	);
});

test("mcp__ tools match the prefix and fall back through arg keys", () => {
	assertEquals(
		toolTitle("running", "mcp__github__search_code", {
			query: "requestCancellation",
		}),
		"mcp__github__search_code requestCancellation",
	);
});

test("an unlisted extension tool falls back to the bare tool name", () => {
	assertEquals(
		toolTitle("running", "some_future_tool", { anything: "here" }),
		"some_future_tool",
	);
});

test("a listed tool with none of its arg keys present falls back to the bare tool name", () => {
	assertEquals(toolTitle("running", "ask_user", { notQuestion: "x" }), "ask_user");
});

test("path-bearing tools still win over the extension table", () => {
	assertEquals(
		toolTitle("running", "read", { path: "/tmp/file.txt" }),
		"read /tmp/file.txt",
	);
});
