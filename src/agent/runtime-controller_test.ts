import { test } from "bun:test";

import type {
	AgentSessionEvent,
	AgentSessionRuntime,
	SessionManager,
} from "@earendil-works/pi-coding-agent";

import { assertEquals, assertRejects } from "#testing/assertions";

import { AppStore } from "../state/app-store.ts";
import type { SessionDoneNotification } from "../system-notifications.ts";
import {
	RuntimeController,
	type RuntimeControllerDependencies,
} from "./runtime-controller.ts";
import type { PreparedSessionList } from "./session-catalog.ts";
import {
	agentSessionEventStub,
	agentSessionRuntimeStub,
	sessionManagerStub,
} from "./test-fixtures.ts";

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
	modelRefreshForces: Array<boolean | undefined>;
	reloadCount: number;
	setSessionNames: string[];
	emit(event: AgentSessionEvent): void;
	setCompacting(value: boolean): void;
	setStreaming(value: boolean): void;
	setCompact(value: () => Promise<void>): void;
};

function manager(
	path: string | undefined,
	persisted = true,
	cwd = "/workspace",
): SessionManager {
	return sessionManagerStub({
		getCwd: () => cwd,
		getSessionFile: () => path,
		isPersisted: () => persisted,
		getBranch: () => [],
		getEntries: () => [],
	});
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
	let runtime: AgentSessionRuntime | undefined;
	let compact = () => Promise.resolve();
	const fake: RuntimeFake = {
		get runtime() {
			if (!runtime) throw new Error("runtime fixture is not initialized");
			return runtime;
		},
		set runtime(value: AgentSessionRuntime) {
			runtime = value;
		},
		beforeInvalidate,
		rebind,
		events,
		extensionBindings: [],
		calls,
		disposeCount: 0,
		disposeResult: Promise.resolve(),
		promptResult: Promise.resolve(),
		promptInputs: [],
		modelRefreshForces: [],
		reloadCount: 0,
		setSessionNames: [],
		emit: (event) => {
			if (event.type === "queue_update") {
				steeringMessages.splice(0, steeringMessages.length, ...event.steering);
				followUpMessages.splice(0, followUpMessages.length, ...event.followUp);
			}
			for (const callback of activeSubscriptions) callback(event);
		},
		setCompacting: (value) => {
			session.isCompacting = value;
		},
		setStreaming: (value) => {
			session.isStreaming = value;
		},
		setCompact: (value) => {
			compact = value;
		},
	};
	const modelRuntime = {
		getModels: () => [],
		getModel: () => undefined,
		getProviders: () => [],
		hasConfiguredAuth: () => false,
		refresh: (options?: { force?: boolean }) => {
			fake.modelRefreshForces.push(options?.force);
			return Promise.resolve({ aborted: false, errors: new Map() });
		},
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
		extensionRunner: { getRegisteredCommands: () => [] },
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
		reload: () => {
			fake.reloadCount += 1;
			return Promise.resolve();
		},
		compact: () => compact(),
		abort: () => {
			calls.push("abort");
			session.isStreaming = false;
			return Promise.resolve();
		},
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
		setSessionName: (name: string) => fake.setSessionNames.push(name),
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
	fake.runtime = agentSessionRuntimeStub({
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
	});
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
		createSessionManager: (cwd) => manager(undefined, true, cwd),
		createMemorySessionManager: (cwd) => manager(undefined, false, cwd),
		forkSessionManager: (_sourcePath, cwd) =>
			manager("/sessions/fork.jsonl", true, cwd),
		openSessionManager: (path) => manager(path),
		moveToTrash: () => Promise.resolve(),
		shareSession: () =>
			Promise.resolve({
				shareUrl: "https://pi.dev/session/#gist-id",
				gistUrl: "https://gist.github.com/user/gist-id",
			}),
		getAgentDir: () => "/agent",
		notifySessionDone: () => Promise.resolve(),
	};
}

test("RuntimeController create prepares and activates the runtime", async () => {
	const fake = fakeRuntime();
	const controller = await RuntimeController.create(new AppStore(), "/workspace", {
		dependencies: dependencies([fake]),
	});
	assertEquals(fake.calls, ["create", "bindExtensions", "subscribe"]);
	await controller.dispose();
});

test("RuntimeController production path binds callbacks before activation", async () => {
	const fake = fakeRuntime();
	const controller = await RuntimeController.prepare(new AppStore(), "/workspace", {
		dependencies: dependencies([fake]),
	});
	assertEquals(fake.calls, ["create", "bindExtensions"]);
	assertEquals(fake.extensionBindings[0]?.mode, "rpc");
	assertEquals(Boolean(fake.extensionBindings[0]?.uiContext), true);
	assertEquals(fake.beforeInvalidate.length, 1);
	assertEquals(fake.rebind.length, 1);
	controller.activate();
	assertEquals(fake.calls.filter((call) => call === "subscribe").length, 1);
	await controller.dispose();
	assertEquals(fake.calls.filter((call) => call === "unsubscribe").length, 1);
	assertEquals(fake.disposeCount, 1);
});

test("RuntimeController opens tree commands without prompting the model", async () => {
	const state = new AppStore();
	const fake = fakeRuntime();
	const controller = await RuntimeController.prepare(state, "/workspace", {
		dependencies: dependencies([fake]),
	});
	controller.activate();
	assertEquals(await controller.prompt("/tree"), true);
	assertEquals(fake.promptInputs, []);
	await controller.dispose();
});

test("RuntimeController forces only the first model picker refresh within thirty minutes", async () => {
	const fake = fakeRuntime();
	const controller = await RuntimeController.prepare(new AppStore(), "/workspace", {
		dependencies: dependencies([fake]),
	});

	const originalNow = Date.now;
	let now = originalNow();
	Date.now = () => now;
	try {
		await controller.refreshModels();
		now += 30 * 60 * 1000 - 1;
		await controller.refreshModels();
		now += 1;
		await controller.refreshModels();
		assertEquals(fake.modelRefreshForces, [true, false, true]);
	} finally {
		Date.now = originalNow;
		await controller.dispose();
	}
});

test("RuntimeController preparation does not wait for the session catalog", async () => {
	const fake = fakeRuntime();
	let resolveSessions!: () => void;
	const delayedSessions = new Promise<PreparedSessionList>((resolve) => {
		resolveSessions = () => resolve({ ok: true, sessions: [] });
	});
	const controllerPromise = RuntimeController.prepare(new AppStore(), "/workspace", {
		dependencies: {
			...dependencies([fake]),
			prepareSessions: () => delayedSessions,
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

test("RuntimeController loads the full catalog once during activation", async () => {
	const fake = fakeRuntime();
	const store = new AppStore();
	let loads = 0;
	let resolveLoad!: () => void;
	const load = new Promise<PreparedSessionList>((resolve) => {
		resolveLoad = () => resolve({ ok: true, sessions: [] });
	});
	const controller = await RuntimeController.prepare(store, "/workspace", {
		dependencies: {
			...dependencies([fake]),
			prepareSessions: () => {
				loads += 1;
				return load;
			},
		},
	});
	controller.activate();
	assertEquals(loads, 1);
	const loading = controller.listSessions();
	assertEquals(store.snapshot().sessionCatalogLoading, true);
	resolveLoad();
	await loading;
	assertEquals(store.snapshot().sessionCatalogLoading, false);
	await controller.listSessions();
	assertEquals(loads, 1);
	await controller.dispose();
});

test("RuntimeController binds extension session controls to the active runtime", async () => {
	const fake = fakeRuntime();
	const controller = await RuntimeController.prepare(new AppStore(), "/workspace", {
		dependencies: dependencies([fake]),
	});
	controller.activate();

	const actions = fake.extensionBindings[0]?.commandContextActions;
	if (!actions) throw new Error("missing extension command context actions");
	const options = { parentSession: "/sessions/parent.jsonl" };
	let received: Parameters<AgentSessionRuntime["newSession"]>[0] | undefined;
	fake.runtime.newSession = (value) => {
		received = value;
		return Promise.resolve({ cancelled: false });
	};

	assertEquals(await actions.newSession(options), { cancelled: false });
	assertEquals(received, options);
	await actions.waitForIdle();
	await controller.dispose();
});

test("RuntimeController treats the current session as an immediate no-op", async () => {
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

test("RuntimeController renames the active pi session", async () => {
	const fake = fakeRuntime("/sessions/current.jsonl");
	const controller = await RuntimeController.prepare(new AppStore(), "/workspace", {
		dependencies: dependencies([fake]),
	});
	controller.activate();

	assertEquals(
		await controller.renameSession("/sessions/current.jsonl", "  lowercase title  "),
		true,
	);
	assertEquals(fake.setSessionNames, ["lowercase title"]);
	await controller.dispose();
});

test("RuntimeController replaces and trashes the current idle session", async () => {
	const fake = fakeRuntime("/sessions/current.jsonl");
	let currentPath = "/sessions/current.jsonl";
	fake.runtime.session.sessionManager.getSessionFile = () => currentPath;
	fake.runtime.newSession = async () => {
		currentPath = "/sessions/replacement.jsonl";
		return { cancelled: false };
	};
	const trashed: string[] = [];
	let sessionLoads = 0;
	const store = new AppStore();
	const controller = await RuntimeController.prepare(store, "/workspace", {
		dependencies: {
			...dependencies([fake]),
			prepareSessions: () => {
				sessionLoads += 1;
				return Promise.resolve({ ok: true, sessions: [] });
			},
			moveToTrash: (path) => {
				trashed.push(path);
				return Promise.resolve();
			},
		},
	});
	controller.activate();
	assertEquals(sessionLoads, 1);

	assertEquals(await controller.deleteSession("/sessions/current.jsonl"), true);
	assertEquals(trashed, ["/sessions/current.jsonl"]);
	assertEquals(sessionLoads, 3);
	assertEquals(store.currentSessionPath, "/sessions/replacement.jsonl");
	await controller.dispose();
});

test("RuntimeController clears chat at authoritative session invalidation", async () => {
	const fake = fakeRuntime();
	let releaseReplacement!: () => void;
	const replacement = new Promise<void>((resolve) => {
		releaseReplacement = resolve;
	});
	fake.runtime.newSession = async () => {
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
	assertEquals(fake.modelRefreshForces, []);
	await controller.dispose();
});

test("RuntimeController clears chat before temporary runtime creation", async () => {
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

test("RuntimeController keeps chat when new session is cancelled", async () => {
	const fake = fakeRuntime();
	fake.runtime.newSession = () => Promise.resolve({ cancelled: true });
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

test("RuntimeController ignores callbacks captured before in-place replacement", async () => {
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

test("RuntimeController disposal awaits and attempts foreground and background runtimes", async () => {
	const foreground = fakeRuntime();
	const replacement = fakeRuntime("/sessions/b.jsonl");
	foreground.setStreaming(true);
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

test("RuntimeController shows one error when manual compaction fails", async () => {
	const state = new AppStore();
	const fake = fakeRuntime();
	const controller = await RuntimeController.prepare(state, "/workspace", {
		dependencies: dependencies([fake]),
	});
	controller.activate();
	fake.setCompact(async () => {
		fake.emit(
			agentSessionEventStub({
				type: "compaction_end",
				reason: "manual",
				result: undefined,
				aborted: false,
				willRetry: false,
				errorMessage: "Compaction failed: Nothing to compact (session too small)",
			}),
		);
		throw new Error("Nothing to compact (session too small)");
	});

	assertEquals(await controller.compact(), false);
	assertEquals(
		state.messages.map((message) => message.text),
		["Compaction failed: Nothing to compact (session too small)"],
	);
	await controller.dispose();
});

test("RuntimeController handles share without sending it to the model", async () => {
	const state = new AppStore();
	const fake = fakeRuntime();
	const controller = await RuntimeController.prepare(state, "/workspace", {
		dependencies: dependencies([fake]),
	});
	controller.activate();

	assertEquals(await controller.prompt("/share"), true);
	await new Promise((resolve) => setTimeout(resolve, 0));

	assertEquals(fake.promptInputs, []);
	assertEquals(state.activityText, undefined);
	assertEquals(
		state.messages.map((message) => message.text),
		[
			"Share URL: https://pi.dev/session/#gist-id\n" +
				"Gist: https://gist.github.com/user/gist-id",
		],
	);
	assertEquals(
		state.slashCommands.some((command) => command.name === "share"),
		true,
	);
	await controller.dispose();
});

test("RuntimeController reloads resources without sending the command to the model", async () => {
	const state = new AppStore();
	const fake = fakeRuntime();
	const controller = await RuntimeController.prepare(state, "/workspace", {
		dependencies: dependencies([fake]),
	});
	controller.activate();

	assertEquals(await controller.prompt("/reload"), true);
	await new Promise((resolve) => setTimeout(resolve, 0));

	assertEquals(fake.promptInputs, []);
	assertEquals(fake.reloadCount, 1);
	assertEquals(state.activityText, undefined);
	assertEquals(
		state.messages.at(-1)?.text,
		"Reloaded extensions, skills, prompts, and context files.",
	);
	assertEquals(
		state.slashCommands.some((command) => command.name === "reload"),
		true,
	);
	await controller.dispose();
});

test("RuntimeController shows prompts queued during compaction and sends them afterward", async () => {
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
	fake.emit(
		agentSessionEventStub({
			type: "compaction_end",
			reason: "manual",
			result: undefined,
			aborted: false,
			willRetry: false,
		}),
	);
	await Promise.resolve();

	assertEquals(fake.promptInputs, [
		{ text: "send after compaction", streamingBehavior: undefined },
	]);
	assertEquals(state.queuedSteeringMessages, []);
	assertEquals(state.queuedFollowUpMessages, []);
	await controller.dispose();
});

test("RuntimeController removes one message from the active agent queue", async () => {
	const state = new AppStore();
	const fake = fakeRuntime();
	const controller = await RuntimeController.prepare(state, "/workspace", {
		dependencies: dependencies([fake]),
	});
	controller.activate();
	fake.setStreaming(true);
	fake.emit(
		agentSessionEventStub({
			type: "queue_update",
			steering: ["remove me", "keep me"],
			followUp: ["later"],
		}),
	);

	assertEquals(await controller.removeQueuedMessage("steer", 0), true);
	assertEquals(state.queuedSteeringMessages, ["keep me"]);
	assertEquals(state.queuedFollowUpMessages, ["later"]);
	await controller.dispose();
});

test("RuntimeController keeps foreground activity visible through retry events", async () => {
	const state = new AppStore();
	const runtime = fakeRuntime("/sessions/running.jsonl");
	const controller = await RuntimeController.prepare(state, "/workspace", {
		dependencies: dependencies([runtime]),
	});
	controller.activate();

	runtime.emit(agentSessionEventStub({ type: "agent_start" }));
	assertEquals(state.activityText, "Working...");

	runtime.emit(
		agentSessionEventStub({ type: "auto_retry_end", success: true, attempt: 1 }),
	);
	assertEquals(state.activityText, "Working...");

	runtime.emit(
		agentSessionEventStub({ type: "agent_end", messages: [], willRetry: false }),
	);
	assertEquals(state.activityText, "Working...");
	runtime.emit(agentSessionEventStub({ type: "agent_settled" }));
	assertEquals(state.activityText, undefined);
	await controller.dispose();
});

test("RuntimeController reuses streaming runtimes across repeated background activation", async () => {
	const state = new AppStore();
	const a = fakeRuntime("/sessions/a.jsonl");
	const b = fakeRuntime("/sessions/b.jsonl");
	a.setStreaming(true);
	b.setStreaming(true);
	const controller = await RuntimeController.prepare(state, "/workspace", {
		dependencies: dependencies([a, b]),
	});
	controller.activate();
	a.emit(
		agentSessionEventStub({
			type: "tool_execution_start",
			toolCallId: "call",
			toolName: "bash",
			args: { command: "pwd" },
		}),
	);

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
	a.emit(agentSessionEventStub({ type: "agent_start" }));
	assertEquals(state.activityText, "Working...");
	a.emit(
		agentSessionEventStub({
			type: "queue_update",
			steering: ["now"],
			followUp: ["later"],
		}),
	);
	a.emit(
		agentSessionEventStub({
			type: "tool_execution_end",
			toolCallId: "call",
			toolName: "bash",
			result: { content: [{ type: "text", text: "/workspace" }], details: {} },
			isError: false,
		}),
	);
	assertEquals(state.queuedSteeringMessages, ["now"]);
	assertEquals(state.queuedFollowUpMessages, ["later"]);
	assertEquals(state.messages.length, 1);
	assertEquals(state.messages[0]?.state, "success");
	a.emit(agentSessionEventStub({ type: "agent_end", messages: [], willRetry: false }));
	assertEquals(state.activityText, "Working...");
	a.emit(agentSessionEventStub({ type: "agent_settled" }));
	assertEquals(state.activityText, undefined);
	await controller.dispose();
	assertEquals(a.disposeCount, 1);
	assertEquals(b.disposeCount, 1);
});

test("RuntimeController forks the current session to another workspace", async () => {
	const state = new AppStore();
	const source = fakeRuntime("/sessions/source.jsonl", true, "/work/source");
	const target = fakeRuntime("/sessions/fork.jsonl", true, "/work/target");
	source.setStreaming(true);
	const forkCalls: Array<{ sourcePath: string; cwd: string }> = [];
	const baseDependencies = dependencies([source, target]);
	const controller = await RuntimeController.prepare(state, "/work/source", {
		dependencies: {
			...baseDependencies,
			forkSessionManager: (sourcePath, cwd) => {
				forkCalls.push({ sourcePath, cwd });
				return manager("/sessions/fork.jsonl", true, cwd);
			},
			openSessionManager: (path) => manager(path, true, "/work/target"),
		},
	});
	controller.activate();

	assertEquals(await controller.forkSessionToWorkspace("/work/target"), {
		status: "success",
	});
	assertEquals(forkCalls, [
		{ sourcePath: "/sessions/source.jsonl", cwd: "/work/target" },
	]);
	assertEquals(state.currentSessionPath, "/sessions/fork.jsonl");
	assertEquals(state.workspacePath, "/work/target");
	await controller.dispose();
});

test("RuntimeController preserves a streaming session across workspace changes", async () => {
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

test("RuntimeController preserves the current workspace when replacement preparation fails", async () => {
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

test("RuntimeController disposes an idle session on workspace change", async () => {
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

test("RuntimeController preserves a runtime while accepted prompt work is pending", async () => {
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

test("RuntimeController aborts and disposes an active temporary runtime", async () => {
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

test("RuntimeController completes and aborts background runtimes exactly once", async () => {
	const completed = fakeRuntime("/sessions/completed.jsonl");
	const foreground = fakeRuntime("/sessions/foreground.jsonl");
	completed.setStreaming(true);
	const controller = await RuntimeController.prepare(new AppStore(), "/workspace", {
		dependencies: dependencies([completed, foreground]),
	});
	controller.activate();
	assertEquals((await controller.newSession()).status, "success");
	completed.emit(agentSessionEventStub({ type: "agent_end" }));
	completed.emit(agentSessionEventStub({ type: "agent_settled" }));
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

test("RuntimeController notifies for completed foreground work only while unfocused", async () => {
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
	focused.emit(agentSessionEventStub({ type: "agent_end" }));
	focused.emit(agentSessionEventStub({ type: "agent_settled" }));
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
	unfocused.emit(agentSessionEventStub({ type: "agent_end" }));
	unfocused.emit(agentSessionEventStub({ type: "agent_settled" }));
	await Promise.resolve();
	assertEquals(notifications, [
		{
			workspace: "/workspace",
			sessionPath: "/sessions/unfocused.jsonl",
		},
	]);
	await unfocusedController.dispose();
});

test("RuntimeController always notifies for completed background work", async () => {
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
	background.emit(agentSessionEventStub({ type: "agent_end" }));
	background.emit(agentSessionEventStub({ type: "agent_settled" }));
	assertEquals(notifications, [
		{
			workspace: "/workspace",
			sessionPath: "/sessions/background.jsonl",
		},
	]);
	await controller.dispose();
});

test("RuntimeController disposes a prepared runtime when extension binding fails", async () => {
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
