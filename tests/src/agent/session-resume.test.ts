import { test } from "bun:test";
import path from "node:path";

import {
	executeSessionResume,
	type SessionResumeRuntimeState,
} from "#src/agent/session-resume.ts";
import { assertEquals, assertRejects } from "#testing/assertions";

type Manager = { path: string; cwd: string };

function resumeHarness(
	state: SessionResumeRuntimeState,
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
			state: () => state,
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
					path: path.resolve(sessionPath),
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

async function expectResume(
	fake: ReturnType<typeof resumeHarness>,
	expected: {
		path?: string;
		accepted?: boolean;
		logicalOpenCount: number;
		events: string[];
	},
): Promise<void> {
	assertEquals(
		await executeSessionResume(expected.path ?? "session.jsonl", fake.operations),
		expected.accepted ?? true,
	);
	assertEquals(fake.logicalOpenCount, expected.logicalOpenCount);
	assertEquals(fake.events, expected.events);
}

test("idle persisted resume delegates to one SDK logical open", async () => {
	const fake = resumeHarness({ active: false, persisted: true });
	await expectResume(fake, { logicalOpenCount: 1, events: ["switch"] });
});

test("background activation performs no session open", async () => {
	const target = path.resolve("session.jsonl");
	const fake = resumeHarness(
		{ active: true, persisted: true },
		{ backgroundPath: target },
	);
	await expectResume(fake, {
		path: "./session.jsonl",
		logicalOpenCount: 0,
		events: ["activate-background"],
	});
});

test("active foreground opens one manager and backgrounds the runtime", async () => {
	const fake = resumeHarness({ active: true, persisted: true });
	await expectResume(fake, {
		logicalOpenCount: 1,
		events: ["open", "background", "create"],
	});
});

test("temporary foreground opens once and preserves cross-workspace cwd", async () => {
	const fake = resumeHarness(
		{ active: true, persisted: false },
		{ managerCwd: "/another-workspace" },
	);
	await expectResume(fake, {
		logicalOpenCount: 1,
		events: ["open", "discard", "create"],
	});
	assertEquals(fake.replacementManager?.cwd, "/another-workspace");
});

test("idle temporary foreground opens once and disposes the runtime", async () => {
	const fake = resumeHarness({ active: false, persisted: false });
	await expectResume(fake, {
		logicalOpenCount: 1,
		events: ["open", "dispose", "create"],
	});
});

test("malformed replacement target fails before runtime invalidation", async () => {
	const fake = resumeHarness(
		{ active: true, persisted: true },
		{ openError: new Error("malformed") },
	);
	await assertRejects(() => executeSessionResume("bad.jsonl", fake.operations));
	assertEquals(fake.events, ["open"]);
});

test("extension cancellation keeps the idle persisted runtime", async () => {
	const fake = resumeHarness(
		{ active: false, persisted: true },
		{ cancelSwitch: true },
	);
	await expectResume(fake, {
		accepted: false,
		logicalOpenCount: 1,
		events: ["switch"],
	});
});
