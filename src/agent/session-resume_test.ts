import { test } from "bun:test";
import path from "node:path";

import {
	assertEquals as assertEqual,
	assertEquals as assertEvents,
	assertRejects,
} from "#testing/assertions";

import {
	canonicalSessionPath,
	executeSessionResume,
	type SessionResumeRuntimeState,
} from "./session-resume.ts";

type Manager = { path: string; cwd: string };

function resumeHarness(
	state: Omit<SessionResumeRuntimeState, "observedRunning"> &
		Partial<Pick<SessionResumeRuntimeState, "observedRunning">>,
	options: {
		backgroundPath?: string;
		cancelSwitch?: boolean;
		openError?: Error;
		managerCwd?: string;
	} = {},
) {
	const events: string[] = [];
	let openCount = 0;
	let switchCount = 0;
	let replacementManager: Manager | undefined;
	const background = options.backgroundPath
		? { path: options.backgroundPath }
		: undefined;
	return {
		events,
		get logicalOpenCount() {
			return openCount + switchCount;
		},
		get replacementManager() {
			return replacementManager;
		},
		operations: {
			state: () => ({ observedRunning: false, ...state }),
			findBackground: (target: string) =>
				background?.path === target ? background : undefined,
			activateBackground: async () => {
				events.push("activate-background");
			},
			openSession: (sessionPath: string) => {
				openCount += 1;
				events.push("open");
				if (options.openError) throw options.openError;
				return {
					path: canonicalSessionPath(sessionPath),
					cwd: options.managerCwd ?? "/workspace",
				};
			},
			replaceRuntime: async (
				manager: Manager,
				action: "background" | "discard" | "dispose",
			) => {
				replacementManager = manager;
				events.push(action, "create");
			},
			switchSession: async () => {
				switchCount += 1;
				events.push("switch");
				return { cancelled: options.cancelSwitch ?? false };
			},
		},
	};
}

test("idle persisted resume delegates to one SDK logical open", async () => {
	const fake = resumeHarness({ streaming: false, persisted: true });
	assertEqual(await executeSessionResume("session.jsonl", fake.operations), true);
	assertEqual(fake.logicalOpenCount, 1);
	assertEvents(fake.events, ["switch"]);
});

test("background activation performs no session open", async () => {
	const target = canonicalSessionPath("session.jsonl");
	const fake = resumeHarness(
		{ streaming: true, persisted: true },
		{ backgroundPath: target },
	);
	assertEqual(await executeSessionResume("./session.jsonl", fake.operations), true);
	assertEqual(fake.logicalOpenCount, 0);
	assertEvents(fake.events, ["activate-background"]);
});

test("streaming foreground opens one manager and backgrounds the runtime", async () => {
	const fake = resumeHarness({ streaming: true, persisted: true });
	assertEqual(await executeSessionResume("session.jsonl", fake.operations), true);
	assertEqual(fake.logicalOpenCount, 1);
	assertEvents(fake.events, ["open", "background", "create"]);
});

test("observed lifecycle preserves a persisted runtime when SDK streaming is false", async () => {
	const fake = resumeHarness({
		streaming: false,
		observedRunning: true,
		persisted: true,
	});
	assertEqual(await executeSessionResume("session.jsonl", fake.operations), true);
	assertEqual(fake.logicalOpenCount, 1);
	assertEvents(fake.events, ["open", "background", "create"]);
});

test("temporary foreground opens once and preserves cross-workspace cwd", async () => {
	const fake = resumeHarness(
		{ streaming: true, persisted: false },
		{ managerCwd: "/another-workspace" },
	);
	assertEqual(await executeSessionResume("session.jsonl", fake.operations), true);
	assertEqual(fake.logicalOpenCount, 1);
	assertEqual(fake.replacementManager?.cwd, "/another-workspace");
	assertEvents(fake.events, ["open", "discard", "create"]);
});

test("idle temporary foreground opens once and disposes the runtime", async () => {
	const fake = resumeHarness({ streaming: false, persisted: false });
	assertEqual(await executeSessionResume("session.jsonl", fake.operations), true);
	assertEqual(fake.logicalOpenCount, 1);
	assertEvents(fake.events, ["open", "dispose", "create"]);
});

test("malformed replacement target fails before runtime invalidation", async () => {
	const fake = resumeHarness(
		{ streaming: true, persisted: true },
		{ openError: new Error("malformed") },
	);
	await assertRejects(() => executeSessionResume("bad.jsonl", fake.operations));
	assertEvents(fake.events, ["open"]);
});

test("extension cancellation keeps the idle persisted runtime", async () => {
	const fake = resumeHarness(
		{ streaming: false, persisted: true },
		{ cancelSwitch: true },
	);
	assertEqual(await executeSessionResume("session.jsonl", fake.operations), false);
	assertEqual(fake.logicalOpenCount, 1);
	assertEvents(fake.events, ["switch"]);
});

test("session paths use SDK-compatible POSIX and Windows lexical resolution", () => {
	assertEqual(
		canonicalSessionPath("~/sessions/../one.jsonl", {
			homeDir: "/home/test",
			pathApi: path.posix,
			platform: "linux",
		}),
		"/home/test/one.jsonl",
	);
	assertEqual(
		canonicalSessionPath("~\\sessions\\..\\one.jsonl", {
			homeDir: "C:\\Users\\test",
			pathApi: path.win32,
			platform: "windows",
		}),
		"C:\\Users\\test\\one.jsonl",
	);
});
