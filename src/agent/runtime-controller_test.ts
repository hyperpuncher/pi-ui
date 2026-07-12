import type {
	AgentSessionEvent,
	AgentSessionRuntime,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { assertEquals, assertRejects } from "@std/assert";

import { AppStore } from "../state/app-store.ts";
import {
	RuntimeController,
	type RuntimeControllerDependencies,
} from "./runtime-controller.ts";

type Callback = () => void | Promise<void>;

type RuntimeFake = {
	runtime: AgentSessionRuntime;
	beforeInvalidate: Callback[];
	rebind: Callback[];
	events: Array<(event: AgentSessionEvent) => void>;
	calls: string[];
	disposeCount: number;
	disposeResult: Promise<void>;
	disposeError?: Error;
	emit(event: AgentSessionEvent): void;
	setStreaming(value: boolean): void;
};

function manager(path: string | undefined, persisted = true): SessionManager {
	return {
		getCwd: () => "/workspace",
		getSessionFile: () => path,
		isPersisted: () => persisted,
		getBranch: () => [],
	} as unknown as SessionManager;
}

function fakeRuntime(path = "/sessions/a.jsonl", persisted = true): RuntimeFake {
	const beforeInvalidate: Callback[] = [];
	const rebind: Callback[] = [];
	const events: Array<(event: AgentSessionEvent) => void> = [];
	const calls: string[] = [];
	const activeSubscriptions = new Set<(event: AgentSessionEvent) => void>();
	const fake: RuntimeFake = {
		runtime: undefined as unknown as AgentSessionRuntime,
		beforeInvalidate,
		rebind,
		events,
		calls,
		disposeCount: 0,
		disposeResult: Promise.resolve(),
		emit: (event) => {
			for (const callback of activeSubscriptions) callback(event);
		},
		setStreaming: (value) => {
			(session as { isStreaming: boolean }).isStreaming = value;
		},
	};
	const session = {
		isStreaming: false,
		sessionManager: manager(path, persisted),
		model: undefined,
		scopedModels: [],
		modelRegistry: { getAll: () => [], hasConfiguredAuth: () => false },
		promptTemplates: [],
		resourceLoader: { getSkills: () => ({ skills: [] }) },
		thinkingLevel: "off",
		getAvailableThinkingLevels: () => ["off"],
		getSessionStats: () => ({
			cost: 0,
			tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			contextUsage: null,
		}),
		bindExtensions: () => {
			calls.push("bindExtensions");
			return Promise.resolve();
		},
		subscribe: (callback: (event: AgentSessionEvent) => void) => {
			calls.push("subscribe");
			events.push(callback);
			activeSubscriptions.add(callback);
			return () => {
				if (!activeSubscriptions.delete(callback)) return;
				calls.push("unsubscribe");
			};
		},
	};
	fake.runtime = {
		session,
		setBeforeSessionInvalidate: (callback: Callback) =>
			beforeInvalidate.push(callback),
		setRebindSession: (callback: Callback) => rebind.push(callback),
		newSession: async () => ({ cancelled: false }),
		dispose: () => {
			fake.disposeCount += 1;
			calls.push("dispose");
			if (fake.disposeError) throw fake.disposeError;
			return fake.disposeResult;
		},
		services: {},
	} as unknown as AgentSessionRuntime;
	(session as { abort?: () => Promise<void> }).abort = () => {
		calls.push("abort");
		(session as { isStreaming: boolean }).isStreaming = false;
		return Promise.resolve();
	};
	return fake;
}

function dependencies(runtimes: RuntimeFake[]): RuntimeControllerDependencies {
	let next = 0;
	return {
		createRuntime: () => {
			const fake = runtimes[next++];
			if (!fake) throw new Error("unexpected runtime creation");
			fake.calls.push("create");
			return Promise.resolve(fake.runtime);
		},
		prepareSessions: () => Promise.resolve({ ok: true, sessions: [] }),
		refreshSessions: () => Promise.resolve({ ok: true, sessions: [] }),
		createSessionManager: () => manager(undefined),
		createMemorySessionManager: () => manager(undefined, false),
		openSessionManager: (path) => manager(path),
		moveToTrash: () => Promise.resolve(),
		getAgentDir: () => "/agent",
	};
}

Deno.test("RuntimeController production path binds callbacks before activation", async () => {
	const fake = fakeRuntime();
	const controller = await RuntimeController.prepare(new AppStore(), "/workspace", {
		dependencies: dependencies([fake]),
	});
	assertEquals(fake.calls, ["create", "bindExtensions"]);
	assertEquals(fake.beforeInvalidate.length, 1);
	assertEquals(fake.rebind.length, 1);
	controller.activate();
	assertEquals(fake.calls.filter((call) => call === "subscribe").length, 1);
	await controller.dispose();
	assertEquals(fake.calls.filter((call) => call === "unsubscribe").length, 1);
	assertEquals(fake.disposeCount, 1);
});

Deno.test("RuntimeController ignores callbacks captured before in-place replacement", async () => {
	const fake = fakeRuntime();
	const controller = await RuntimeController.prepare(new AppStore(), "/workspace", {
		dependencies: dependencies([fake]),
	});
	controller.activate();
	const oldInvalidate = fake.beforeInvalidate[0];
	const oldRebind = fake.rebind[0];
	assertEquals((await controller.newSession()).status, "success");
	const callsAfterReplacement = fake.calls.length;
	await oldInvalidate();
	await oldRebind();
	assertEquals(fake.calls.length, callsAfterReplacement);
	assertEquals(fake.beforeInvalidate.length, 2);
	assertEquals(fake.rebind.length, 2);
	await controller.dispose();
});

Deno.test("RuntimeController disposal awaits and attempts foreground and background runtimes", async () => {
	const foreground = fakeRuntime();
	const replacement = fakeRuntime("/sessions/b.jsonl");
	(foreground.runtime.session as unknown as { isStreaming: boolean }).isStreaming =
		true;
	const controller = await RuntimeController.prepare(new AppStore(), "/workspace", {
		dependencies: dependencies([foreground, replacement]),
	});
	controller.activate();
	assertEquals((await controller.newSession()).status, "success");

	let releaseForeground!: () => void;
	foreground.disposeResult = new Promise((resolve) => {
		releaseForeground = resolve;
	});
	replacement.disposeError = new Error("replacement failed");
	const disposal = controller.dispose();
	await Promise.resolve();
	assertEquals(foreground.disposeCount, 1);
	assertEquals(replacement.disposeCount, 1);
	let settled = false;
	disposal
		.finally(() => {
			settled = true;
		})
		.catch(() => {});
	await Promise.resolve();
	assertEquals(settled, false);
	releaseForeground();
	await assertRejects(
		() => disposal,
		AggregateError,
		"Failed to dispose owned runtimes",
	);
	assertEquals(foreground.disposeCount, 1);
	assertEquals(replacement.disposeCount, 1);
});

Deno.test("RuntimeController reuses streaming runtimes across repeated background activation", async () => {
	const state = new AppStore();
	const a = fakeRuntime("/sessions/a.jsonl");
	const b = fakeRuntime("/sessions/b.jsonl");
	a.setStreaming(true);
	b.setStreaming(true);
	const controller = await RuntimeController.prepare(state, "/workspace", {
		dependencies: dependencies([a, b]),
	});
	controller.activate();

	for (const path of [
		"/sessions/b.jsonl",
		"/sessions/a.jsonl",
		"/sessions/b.jsonl",
		"/sessions/a.jsonl",
	]) {
		const result = await controller.resumeSession(path);
		assertEquals(result, { status: "success" });
	}

	assertEquals(a.calls.filter((call) => call === "create").length, 1);
	assertEquals(b.calls.filter((call) => call === "create").length, 1);
	assertEquals(a.calls.filter((call) => call === "subscribe").length, 5);
	assertEquals(a.calls.filter((call) => call === "unsubscribe").length, 4);
	a.emit({ type: "agent_start" } as AgentSessionEvent);
	assertEquals(state.activityText, "Working...");
	a.emit({
		type: "queue_update",
		steering: ["now"],
		followUp: ["later"],
	} as AgentSessionEvent);
	a.emit({
		type: "tool_execution_start",
		toolCallId: "call",
		toolName: "bash",
		args: { command: "pwd" },
	} as AgentSessionEvent);
	assertEquals(state.queuedSteeringMessages, ["now"]);
	assertEquals(state.queuedFollowUpMessages, ["later"]);
	assertEquals(state.messages.length, 1);
	a.emit({ type: "agent_end", messages: [], willRetry: false } as AgentSessionEvent);
	assertEquals(state.activityText, undefined);
	await controller.dispose();
	assertEquals(a.disposeCount, 1);
	assertEquals(b.disposeCount, 1);
});

Deno.test("RuntimeController aborts and disposes an active temporary runtime", async () => {
	const temporary = fakeRuntime(undefined, false);
	const replacement = fakeRuntime("/sessions/replacement.jsonl");
	temporary.setStreaming(true);
	const controller = await RuntimeController.prepare(new AppStore(), "/workspace", {
		dependencies: dependencies([temporary, replacement]),
	});
	controller.activate();
	assertEquals((await controller.newSession()).status, "success");
	assertEquals(
		temporary.calls.filter((call) =>
			["unsubscribe", "abort", "dispose"].includes(call),
		),
		["unsubscribe", "abort", "dispose"],
	);
	assertEquals(temporary.disposeCount, 1);
	assertEquals(
		await controller.abortBackgroundSession("/sessions/replacement.jsonl"),
		false,
	);
	await controller.dispose();
	assertEquals(temporary.disposeCount, 1);
	assertEquals(replacement.disposeCount, 1);
});

Deno.test("RuntimeController completes and aborts background runtimes exactly once", async () => {
	const completed = fakeRuntime("/sessions/completed.jsonl");
	const foreground = fakeRuntime("/sessions/foreground.jsonl");
	completed.setStreaming(true);
	const controller = await RuntimeController.prepare(new AppStore(), "/workspace", {
		dependencies: dependencies([completed, foreground]),
	});
	controller.activate();
	assertEquals((await controller.newSession()).status, "success");
	completed.emit({ type: "agent_end" } as AgentSessionEvent);
	assertEquals(
		await controller.abortBackgroundSession("/sessions/completed.jsonl"),
		false,
	);
	assertEquals(completed.calls.filter((call) => call === "unsubscribe").length, 2);
	assertEquals(await controller.deleteSession("/sessions/completed.jsonl"), true);
	assertEquals(completed.disposeCount, 1);
	await controller.dispose();
	assertEquals(completed.disposeCount, 1);
	assertEquals(foreground.disposeCount, 1);

	const running = fakeRuntime("/sessions/running.jsonl");
	const next = fakeRuntime("/sessions/next.jsonl");
	running.setStreaming(true);
	const second = await RuntimeController.prepare(new AppStore(), "/workspace", {
		dependencies: dependencies([running, next]),
	});
	second.activate();
	assertEquals((await second.newSession()).status, "success");
	assertEquals(await second.abortBackgroundSession("/sessions/running.jsonl"), true);
	assertEquals(running.calls.filter((call) => call === "abort").length, 1);
	await second.dispose();
	assertEquals(running.disposeCount, 1);
	assertEquals(next.disposeCount, 1);
});

Deno.test("RuntimeController disposes a prepared runtime when extension binding fails", async () => {
	const fake = fakeRuntime();
	fake.runtime.session.bindExtensions = () => Promise.reject(new Error("bind failed"));
	await assertRejects(
		() =>
			RuntimeController.prepare(new AppStore(), "/workspace", {
				dependencies: dependencies([fake]),
			}),
		Error,
		"bind failed",
	);
	assertEquals(fake.disposeCount, 1);
	assertEquals(fake.events.length, 0);
});
