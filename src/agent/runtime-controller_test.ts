import type {
	AgentSessionEvent,
	AgentSessionRuntime,
	SessionManager,
} from "@earendil-works/pi-coding-agent";
import { assertEquals, assertRejects } from "@std/assert";

import type { SessionDoneNotification } from "../desktop-notifications.ts";
import { AppStore } from "../state/app-store.ts";
import {
	RuntimeController,
	type RuntimeControllerDependencies,
} from "./runtime-controller.ts";
import type { PreparedSessionList } from "./session-catalog.ts";

type Callback = () => void | Promise<void>;
type ExtensionBindings = Parameters<AgentSessionRuntime["session"]["bindExtensions"]>[0];

type RuntimeFake = {
	runtime: AgentSessionRuntime;
	beforeInvalidate: Callback[];
	rebind: Callback[];
	events: Array<(event: AgentSessionEvent) => void>;
	extensionBindings: ExtensionBindings[];
	calls: string[];
	disposeCount: number;
	disposeResult: Promise<void>;
	disposeError?: Error;
	promptResult: Promise<void>;
	promptInputs: Array<{
		text: string;
		streamingBehavior: "steer" | "followUp" | undefined;
	}>;
	emit(event: AgentSessionEvent): void;
	setCompacting(value: boolean): void;
	setStreaming(value: boolean): void;
};

function manager(
	path: string | undefined,
	persisted = true,
	cwd = "/workspace",
): SessionManager {
	return {
		getCwd: () => cwd,
		getSessionFile: () => path,
		isPersisted: () => persisted,
		getBranch: () => [],
		getEntries: () => [],
	} as unknown as SessionManager;
}

function fakeRuntime(
	path = "/sessions/a.jsonl",
	persisted = true,
	cwd = "/workspace",
): RuntimeFake {
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
		extensionBindings: [],
		calls,
		disposeCount: 0,
		disposeResult: Promise.resolve(),
		promptResult: Promise.resolve(),
		promptInputs: [],
		emit: (event) => {
			if (event.type === "queue_update") {
				steeringMessages.splice(0, steeringMessages.length, ...event.steering);
				followUpMessages.splice(0, followUpMessages.length, ...event.followUp);
			}
			for (const callback of activeSubscriptions) callback(event);
		},
		setCompacting: (value) => {
			(session as { isCompacting: boolean }).isCompacting = value;
		},
		setStreaming: (value) => {
			(session as { isStreaming: boolean }).isStreaming = value;
		},
	};
	const modelRuntime = {
		getModels: () => [],
		getModel: () => undefined,
		getProviders: () => [],
		hasConfiguredAuth: () => false,
		refresh: () => Promise.resolve({ aborted: false, errors: new Map() }),
	};
	const steeringMessages: string[] = [];
	const followUpMessages: string[] = [];
	const session = {
		isCompacting: false,
		isStreaming: false,
		sessionManager: manager(path, persisted, cwd),
		model: undefined,
		scopedModels: [],
		modelRuntime,
		promptTemplates: [],
		resourceLoader: { getSkills: () => ({ skills: [] }) },
		thinkingLevel: "off",
		getAvailableThinkingLevels: () => ["off"],
		getSessionStats: () => ({
			cost: 0,
			tokens: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
			contextUsage: null,
		}),
		bindExtensions: (bindings: ExtensionBindings) => {
			calls.push("bindExtensions");
			fake.extensionBindings.push(bindings);
			return Promise.resolve();
		},
		waitForIdle: () => Promise.resolve(),
		prompt: async (
			text: string,
			options?: {
				preflightResult?: (accepted: boolean) => void;
				streamingBehavior?: "steer" | "followUp";
			},
		) => {
			calls.push("prompt");
			fake.promptInputs.push({
				text,
				streamingBehavior: options?.streamingBehavior,
			});
			options?.preflightResult?.(true);
			await fake.promptResult;
		},
		clearQueue: () => {
			const queued = {
				steering: steeringMessages.splice(0),
				followUp: followUpMessages.splice(0),
			};
			return queued;
		},
		getSteeringMessages: () => steeringMessages,
		getFollowUpMessages: () => followUpMessages,
		steer: (text: string) => {
			steeringMessages.push(text);
			return Promise.resolve();
		},
		followUp: (text: string) => {
			followUpMessages.push(text);
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
		services: { modelRuntime },
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
		prepareRecentSessions: () => Promise.resolve({ ok: true, sessions: [] }),
		prepareSessions: () => Promise.resolve({ ok: true, sessions: [] }),
		refreshSessions: () => Promise.resolve({ ok: true, sessions: [] }),
		createSessionManager: (cwd) => manager(undefined, true, cwd),
		createMemorySessionManager: (cwd) => manager(undefined, false, cwd),
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

Deno.test("RuntimeController preparation does not wait for the session catalog", async () => {
	const fake = fakeRuntime();
	let resolveSessions!: () => void;
	const delayedSessions = new Promise<PreparedSessionList>((resolve) => {
		resolveSessions = () => resolve({ ok: true, sessions: [] });
	});
	const controllerPromise = RuntimeController.prepare(new AppStore(), "/workspace", {
		dependencies: {
			...dependencies([fake]),
			prepareRecentSessions: () => delayedSessions,
		},
	});
	let timeout: ReturnType<typeof setTimeout> | undefined;
	const result = await Promise.race([
		controllerPromise,
		new Promise<"timeout">((resolve) => {
			timeout = setTimeout(() => resolve("timeout"), 100);
		}),
	]);
	clearTimeout(timeout);
	if (result === "timeout") {
		throw new Error("Runtime preparation waited for session discovery");
	}

	result.activate();
	assertEquals(fake.calls.filter((call) => call === "subscribe").length, 1);
	resolveSessions();
	await delayedSessions;
	await result.dispose();
});

Deno.test("RuntimeController warms the full catalog only when the session stream connects", async () => {
	const fake = fakeRuntime();
	const store = new AppStore();
	let recentLoads = 0;
	let fullLoads = 0;
	let resolveFullLoad!: () => void;
	const fullLoad = new Promise<PreparedSessionList>((resolve) => {
		resolveFullLoad = () => resolve({ ok: true, sessions: [] });
	});
	const controller = await RuntimeController.prepare(store, "/workspace", {
		dependencies: {
			...dependencies([fake]),
			prepareRecentSessions: () => {
				recentLoads += 1;
				return Promise.resolve({ ok: true, sessions: [] });
			},
			prepareSessions: () => {
				fullLoads += 1;
				return fullLoad;
			},
		},
	});
	controller.activate();
	assertEquals({ recentLoads, fullLoads }, { recentLoads: 1, fullLoads: 0 });
	const loading = controller.listSessions();
	while (fullLoads === 0) await Promise.resolve();
	assertEquals(store.snapshot().sessionCatalogLoading, true);
	resolveFullLoad();
	await loading;
	assertEquals(store.snapshot().sessionCatalogLoading, false);
	await controller.listSessions();
	assertEquals({ recentLoads, fullLoads }, { recentLoads: 1, fullLoads: 1 });
	await controller.dispose();
});

Deno.test("RuntimeController binds extension session controls to the active runtime", async () => {
	const fake = fakeRuntime();
	const controller = await RuntimeController.prepare(new AppStore(), "/workspace", {
		dependencies: dependencies([fake]),
	});
	controller.activate();

	const actions = fake.extensionBindings[0]?.commandContextActions;
	if (!actions) throw new Error("missing extension command context actions");
	const options = { parentSession: "/sessions/parent.jsonl" };
	let received: unknown;
	(
		fake.runtime as unknown as {
			newSession: (value: unknown) => Promise<{ cancelled: boolean }>;
		}
	).newSession = (value) => {
		received = value;
		return Promise.resolve({ cancelled: false });
	};

	assertEquals(await actions.newSession(options), { cancelled: false });
	assertEquals(received, options);
	await actions.waitForIdle();
	await controller.dispose();
});

Deno.test("RuntimeController treats the current session as an immediate no-op", async () => {
	const fake = fakeRuntime();
	const controller = await RuntimeController.prepare(new AppStore(), "/workspace", {
		dependencies: dependencies([fake]),
	});
	controller.activate();
	const calls = [...fake.calls];

	assertEquals(await controller.resumeSession("/sessions/a.jsonl"), {
		status: "success",
	});
	assertEquals(fake.calls, calls);
	await controller.dispose();
});

Deno.test("RuntimeController replaces and trashes the current idle session", async () => {
	const fake = fakeRuntime("/sessions/current.jsonl");
	let currentPath = "/sessions/current.jsonl";
	(
		fake.runtime.session.sessionManager as unknown as {
			getSessionFile: () => string;
		}
	).getSessionFile = () => currentPath;
	(
		fake.runtime as unknown as {
			newSession: () => Promise<{ cancelled: boolean }>;
		}
	).newSession = async () => {
		currentPath = "/sessions/replacement.jsonl";
		return { cancelled: false };
	};
	const trashed: string[] = [];
	const store = new AppStore();
	const controller = await RuntimeController.prepare(store, "/workspace", {
		dependencies: {
			...dependencies([fake]),
			moveToTrash: (path) => {
				trashed.push(path);
				return Promise.resolve();
			},
		},
	});
	controller.activate();

	assertEquals(await controller.deleteSession("/sessions/current.jsonl"), true);
	assertEquals(trashed, ["/sessions/current.jsonl"]);
	assertEquals(store.currentSessionPath, "/sessions/replacement.jsonl");
	await controller.dispose();
});

Deno.test("RuntimeController clears chat at authoritative session invalidation", async () => {
	const fake = fakeRuntime();
	let releaseReplacement!: () => void;
	const replacement = new Promise<void>((resolve) => {
		releaseReplacement = resolve;
	});
	(
		fake.runtime as unknown as {
			newSession: () => Promise<{ cancelled: boolean }>;
		}
	).newSession = async () => {
		await fake.beforeInvalidate.at(-1)?.();
		await replacement;
		return { cancelled: false };
	};
	const store = new AppStore();
	store.appendMessage("user", "old session");
	const controller = await RuntimeController.prepare(store, "/workspace", {
		dependencies: dependencies([fake]),
	});
	controller.activate();

	const transition = controller.newSession();
	await Promise.resolve();
	assertEquals(store.messages, []);
	releaseReplacement();
	assertEquals((await transition).status, "success");
	await controller.dispose();
});

Deno.test("RuntimeController clears chat before temporary runtime creation", async () => {
	const current = fakeRuntime();
	const replacement = fakeRuntime(undefined, false);
	let releaseCreation!: () => void;
	const creation = new Promise<void>((resolve) => {
		releaseCreation = resolve;
	});
	let createCount = 0;
	const store = new AppStore();
	store.appendMessage("user", "old session");
	const controller = await RuntimeController.prepare(store, "/workspace", {
		dependencies: {
			...dependencies([]),
			createRuntime: async () => {
				createCount += 1;
				if (createCount === 1) return current.runtime;
				await creation;
				return replacement.runtime;
			},
		},
	});
	controller.activate();

	const transition = controller.newTemporarySession();
	await Promise.resolve();
	await Promise.resolve();
	assertEquals(store.messages, []);
	releaseCreation();
	assertEquals((await transition).status, "success");
	await controller.dispose();
});

Deno.test("RuntimeController keeps chat when new session is cancelled", async () => {
	const fake = fakeRuntime();
	(
		fake.runtime as unknown as {
			newSession: () => Promise<{ cancelled: boolean }>;
		}
	).newSession = () => Promise.resolve({ cancelled: true });
	const store = new AppStore();
	store.appendMessage("user", "old session");
	const controller = await RuntimeController.prepare(store, "/workspace", {
		dependencies: dependencies([fake]),
	});
	controller.activate();

	assertEquals((await controller.newSession()).status, "cancelled");
	assertEquals(
		store.messages.map((message) => message.text),
		["old session"],
	);
	await controller.dispose();
});

Deno.test("RuntimeController ignores callbacks captured before in-place replacement", async () => {
	const fake = fakeRuntime();
	const store = new AppStore();
	const loadingOverlays: boolean[] = [];
	const setSessionTransition = store.setSessionTransition.bind(store);
	store.setSessionTransition = (transition) => {
		if (transition.status === "loading") {
			loadingOverlays.push(transition.overlay);
		}
		setSessionTransition(transition);
	};
	const controller = await RuntimeController.prepare(store, "/workspace", {
		dependencies: dependencies([fake]),
	});
	controller.activate();
	const oldInvalidate = fake.beforeInvalidate[0];
	const oldRebind = fake.rebind[0];
	assertEquals((await controller.newSession()).status, "success");
	assertEquals(loadingOverlays, [false]);
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

Deno.test("RuntimeController shows one error when manual compaction fails", async () => {
	const state = new AppStore();
	const fake = fakeRuntime();
	const controller = await RuntimeController.prepare(state, "/workspace", {
		dependencies: dependencies([fake]),
	});
	controller.activate();
	(fake.runtime.session as unknown as { compact: () => Promise<void> }).compact =
		async () => {
			fake.emit({
				type: "compaction_end",
				reason: "manual",
				result: undefined,
				aborted: false,
				willRetry: false,
				errorMessage: "Compaction failed: Nothing to compact (session too small)",
			} as AgentSessionEvent);
			throw new Error("Nothing to compact (session too small)");
		};

	assertEquals(await controller.compact(), false);
	assertEquals(
		state.messages.map((message) => message.text),
		["Compaction failed: Nothing to compact (session too small)"],
	);
	await controller.dispose();
});

Deno.test("RuntimeController shows prompts queued during compaction and sends them afterward", async () => {
	const state = new AppStore();
	const fake = fakeRuntime();
	const controller = await RuntimeController.prepare(state, "/workspace", {
		dependencies: dependencies([fake]),
	});
	controller.activate();
	fake.setCompacting(true);

	assertEquals(await controller.prompt("remove me"), true);
	assertEquals(await controller.prompt("send after compaction"), true);
	assertEquals(fake.promptInputs, []);
	assertEquals(state.queuedSteeringMessages, ["remove me", "send after compaction"]);
	assertEquals(state.queuedFollowUpMessages, []);
	assertEquals(await controller.removeQueuedMessage("steer", 0), true);
	assertEquals(state.queuedSteeringMessages, ["send after compaction"]);
	assertEquals(await controller.removeQueuedMessage("steer", 2), false);

	fake.setCompacting(false);
	fake.emit({
		type: "compaction_end",
		reason: "manual",
		result: undefined,
		aborted: false,
		willRetry: false,
	} as AgentSessionEvent);
	await Promise.resolve();

	assertEquals(fake.promptInputs, [
		{ text: "send after compaction", streamingBehavior: undefined },
	]);
	assertEquals(state.queuedSteeringMessages, []);
	assertEquals(state.queuedFollowUpMessages, []);
	await controller.dispose();
});

Deno.test("RuntimeController removes one message from the active agent queue", async () => {
	const state = new AppStore();
	const fake = fakeRuntime();
	const controller = await RuntimeController.prepare(state, "/workspace", {
		dependencies: dependencies([fake]),
	});
	controller.activate();
	fake.setStreaming(true);
	fake.emit({
		type: "queue_update",
		steering: ["remove me", "keep me"],
		followUp: ["later"],
	} as AgentSessionEvent);

	assertEquals(await controller.removeQueuedMessage("steer", 0), true);
	assertEquals(state.queuedSteeringMessages, ["keep me"]);
	assertEquals(state.queuedFollowUpMessages, ["later"]);
	await controller.dispose();
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

Deno.test("RuntimeController preserves a streaming session across workspace changes", async () => {
	const state = new AppStore();
	const source = fakeRuntime("/sessions/source.jsonl", true, "/work/source");
	const replacement = fakeRuntime(
		"/sessions/replacement.jsonl",
		true,
		"/work/replacement",
	);
	source.setStreaming(true);
	const controller = await RuntimeController.prepare(state, "/work/source", {
		dependencies: dependencies([source, replacement]),
	});
	controller.activate();

	assertEquals(await controller.openWorkspace("/work/replacement"), true);
	assertEquals(state.workspacePath, "/work/replacement");
	assertEquals(source.disposeCount, 0);
	assertEquals(source.calls.filter((call) => call === "unsubscribe").length, 1);

	assertEquals(await controller.resumeSession("/sessions/source.jsonl"), {
		status: "success",
	});
	assertEquals(state.workspacePath, "/work/source");
	assertEquals(source.disposeCount, 0);
	assertEquals(replacement.disposeCount, 1);

	await controller.dispose();
	assertEquals(source.disposeCount, 1);
});

Deno.test("RuntimeController preserves the current workspace when replacement preparation fails", async () => {
	const state = new AppStore();
	const source = fakeRuntime("/sessions/source.jsonl", true, "/work/source");
	const replacement = fakeRuntime(
		"/sessions/replacement.jsonl",
		true,
		"/work/replacement",
	);
	replacement.runtime.session.bindExtensions = () =>
		Promise.reject(new Error("bind failed"));
	const controller = await RuntimeController.prepare(state, "/work/source", {
		dependencies: dependencies([source, replacement]),
	});
	controller.activate();

	await assertRejects(
		() => controller.openWorkspace("/work/replacement"),
		Error,
		"bind failed",
	);
	assertEquals(state.workspacePath, "/work/source");
	assertEquals(source.disposeCount, 0);
	assertEquals(replacement.disposeCount, 1);
	await controller.dispose();
	assertEquals(source.disposeCount, 1);
});

Deno.test("RuntimeController disposes an idle session on workspace change", async () => {
	const source = fakeRuntime("/sessions/source.jsonl", true, "/work/source");
	const replacement = fakeRuntime(
		"/sessions/replacement.jsonl",
		true,
		"/work/replacement",
	);
	const controller = await RuntimeController.prepare(new AppStore(), "/work/source", {
		dependencies: dependencies([source, replacement]),
	});
	controller.activate();

	assertEquals(await controller.openWorkspace("/work/replacement"), true);
	assertEquals(source.disposeCount, 1);
	await controller.dispose();
	assertEquals(replacement.disposeCount, 1);
});

Deno.test("RuntimeController preserves a runtime while accepted prompt work is pending", async () => {
	const source = fakeRuntime();
	const replacement = fakeRuntime("/sessions/replacement.jsonl");
	let finishPrompt!: () => void;
	source.promptResult = new Promise((resolve) => {
		finishPrompt = resolve;
	});
	const controller = await RuntimeController.prepare(new AppStore(), "/workspace", {
		dependencies: dependencies([source, replacement]),
	});
	controller.activate();

	assertEquals(await controller.prompt("hello"), true);
	assertEquals((await controller.newSession()).status, "success");
	assertEquals(source.calls.filter((call) => call === "create").length, 1);
	assertEquals(replacement.calls.filter((call) => call === "create").length, 1);
	assertEquals(source.disposeCount, 0);

	finishPrompt();
	await source.promptResult;
	await controller.dispose();
	assertEquals(source.disposeCount, 1);
	assertEquals(replacement.disposeCount, 1);
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

Deno.test("RuntimeController notifies for completed foreground work only while unfocused", async () => {
	const notifications: SessionDoneNotification[] = [];
	const notifySessionDone = (details: SessionDoneNotification) => {
		notifications.push(details);
		return Promise.resolve();
	};
	const focused = fakeRuntime("/sessions/focused.jsonl");
	const focusedController = await RuntimeController.prepare(
		new AppStore(),
		"/workspace",
		{
			dependencies: dependencies([focused]),
			isApplicationFocused: () => true,
			notifySessionDone,
		},
	);
	focusedController.activate();
	focused.emit({ type: "agent_end" } as AgentSessionEvent);
	assertEquals(notifications, []);
	await focusedController.dispose();

	const unfocused = fakeRuntime("/sessions/unfocused.jsonl");
	const unfocusedController = await RuntimeController.prepare(
		new AppStore(),
		"/workspace",
		{
			dependencies: dependencies([unfocused]),
			isApplicationFocused: () => false,
			notifySessionDone,
		},
	);
	unfocusedController.activate();
	unfocused.emit({ type: "agent_end" } as AgentSessionEvent);
	await Promise.resolve();
	assertEquals(notifications, [
		{
			workspace: "/workspace",
			sessionPath: "/sessions/unfocused.jsonl",
		},
	]);
	await unfocusedController.dispose();
});

Deno.test("RuntimeController always notifies for completed background work", async () => {
	const notifications: SessionDoneNotification[] = [];
	const background = fakeRuntime("/sessions/background.jsonl");
	const foreground = fakeRuntime("/sessions/foreground.jsonl");
	background.setStreaming(true);
	const controller = await RuntimeController.prepare(new AppStore(), "/workspace", {
		dependencies: dependencies([background, foreground]),
		isApplicationFocused: () => true,
		notifySessionDone: (details) => {
			notifications.push(details);
			return Promise.resolve();
		},
	});
	controller.activate();
	assertEquals((await controller.newSession()).status, "success");
	background.emit({ type: "agent_end" } as AgentSessionEvent);
	assertEquals(notifications, [
		{
			workspace: "/workspace",
			sessionPath: "/sessions/background.jsonl",
		},
	]);
	await controller.dispose();
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
