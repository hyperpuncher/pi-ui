import { test } from "bun:test";

import type { AgentSessionRuntime } from "@earendil-works/pi-coding-agent";
import type { AutocompleteItem } from "@earendil-works/pi-tui";

import { assertEquals } from "#testing/assertions";

import type { AppModel, AppThinkingLevel } from "../state/app-store.ts";
import {
	argumentCompletionsTimeoutMs,
	resolveArgumentCompletions,
} from "./argument-completions.ts";
import { agentSessionRuntimeStub } from "./test-fixtures.ts";

const models: readonly AppModel[] = [
	{
		id: "opus",
		provider: "anthropic",
		name: "Claude Opus",
		configured: true,
		scoped: true,
	},
	{ id: "gpt-5", provider: "openai", name: "GPT-5", configured: true, scoped: false },
];
const thinkingLevels: readonly AppThinkingLevel[] = ["off", "low", "high"];

type RegisteredCommandStub = {
	invocationName: string;
	getArgumentCompletions?: (
		prefix: string,
	) => AutocompleteItem[] | null | Promise<AutocompleteItem[] | null>;
};

function runtimeWithCommands(
	commands: readonly RegisteredCommandStub[],
): AgentSessionRuntime {
	return agentSessionRuntimeStub({
		session: {
			extensionRunner: {
				getRegisteredCommands: () => commands,
			},
		},
	});
}

test("resolveArgumentCompletions lists every configured model for /model with an empty prefix", async () => {
	const runtime = runtimeWithCommands([]);
	const result = await resolveArgumentCompletions(
		runtime,
		models,
		thinkingLevels,
		"model",
		"",
	);
	assertEquals(
		result.map((item) => item.value),
		["anthropic/opus", "openai/gpt-5"],
	);
});

test("resolveArgumentCompletions filters /model completions by prefix, case-insensitively", async () => {
	const runtime = runtimeWithCommands([]);
	const result = await resolveArgumentCompletions(
		runtime,
		models,
		thinkingLevels,
		"model",
		"GPT",
	);
	assertEquals(
		result.map((item) => item.value),
		["openai/gpt-5"],
	);
});

test("resolveArgumentCompletions lists thinking levels for /thinking, filtered by prefix", async () => {
	const runtime = runtimeWithCommands([]);
	const all = await resolveArgumentCompletions(
		runtime,
		models,
		thinkingLevels,
		"thinking",
		"",
	);
	assertEquals(
		all.map((item) => item.value),
		["off", "low", "high"],
	);
	const filtered = await resolveArgumentCompletions(
		runtime,
		models,
		thinkingLevels,
		"thinking",
		"h",
	);
	assertEquals(
		filtered.map((item) => item.value),
		["high"],
	);
});

test("resolveArgumentCompletions delegates to a registered extension command's getArgumentCompletions", async () => {
	const calls: string[] = [];
	const runtime = runtimeWithCommands([
		{
			invocationName: "subagent-selector",
			getArgumentCompletions: (prefix) => {
				calls.push(prefix);
				return [{ value: "researcher", label: "researcher" }];
			},
		},
	]);
	const result = await resolveArgumentCompletions(
		runtime,
		models,
		thinkingLevels,
		"subagent-selector",
		"res",
	);
	assertEquals(calls, ["res"]);
	assertEquals(result, [{ value: "researcher", label: "researcher" }]);
});

test("resolveArgumentCompletions returns an empty list for an unknown command name", async () => {
	const runtime = runtimeWithCommands([]);
	const result = await resolveArgumentCompletions(
		runtime,
		models,
		thinkingLevels,
		"not-a-command",
		"",
	);
	assertEquals(result, []);
});

test("resolveArgumentCompletions returns an empty list for a command with no getArgumentCompletions", async () => {
	const runtime = runtimeWithCommands([{ invocationName: "no-completions" }]);
	const result = await resolveArgumentCompletions(
		runtime,
		models,
		thinkingLevels,
		"no-completions",
		"",
	);
	assertEquals(result, []);
});

test("resolveArgumentCompletions isolates a rejected completions promise into an empty list", async () => {
	const runtime = runtimeWithCommands([
		{
			invocationName: "flaky",
			getArgumentCompletions: () => Promise.reject(new Error("boom")),
		},
	]);
	const result = await resolveArgumentCompletions(
		runtime,
		models,
		thinkingLevels,
		"flaky",
		"",
	);
	assertEquals(result, []);
});

test("resolveArgumentCompletions isolates a synchronously throwing command into an empty list", async () => {
	const runtime = runtimeWithCommands([
		{
			invocationName: "throws",
			getArgumentCompletions: () => {
				throw new Error("boom");
			},
		},
	]);
	const result = await resolveArgumentCompletions(
		runtime,
		models,
		thinkingLevels,
		"throws",
		"",
	);
	assertEquals(result, []);
});

test("resolveArgumentCompletions treats a null result the same as no completions", async () => {
	const runtime = runtimeWithCommands([
		{ invocationName: "empty", getArgumentCompletions: () => null },
	]);
	const result = await resolveArgumentCompletions(
		runtime,
		models,
		thinkingLevels,
		"empty",
		"",
	);
	assertEquals(result, []);
});

test("resolveArgumentCompletions gives up on a command that never resolves", async () => {
	const runtime = runtimeWithCommands([
		{
			invocationName: "hangs",
			getArgumentCompletions: () => new Promise(() => {}),
		},
	]);
	const start = Date.now();
	const result = await resolveArgumentCompletions(
		runtime,
		models,
		thinkingLevels,
		"hangs",
		"",
	);
	assertEquals(result, []);
	// Sanity check the timeout is actually being enforced, without pinning exact timing.
	assertEquals(Date.now() - start < argumentCompletionsTimeoutMs + 1000, true);
});

test("resolveArgumentCompletions matches the registered command case-insensitively", async () => {
	const runtime = runtimeWithCommands([
		{
			invocationName: "MixedCase",
			getArgumentCompletions: () => [{ value: "x", label: "x" }],
		},
	]);
	const result = await resolveArgumentCompletions(
		runtime,
		models,
		thinkingLevels,
		"mixedcase",
		"",
	);
	assertEquals(result, [{ value: "x", label: "x" }]);
});

test("resolveArgumentCompletions returns an empty list for a blank command name", async () => {
	const runtime = runtimeWithCommands([]);
	const result = await resolveArgumentCompletions(
		runtime,
		models,
		thinkingLevels,
		"  ",
		"",
	);
	assertEquals(result, []);
});
