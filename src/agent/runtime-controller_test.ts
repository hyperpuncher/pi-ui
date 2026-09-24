import { test } from "bun:test";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type {
	AgentSessionEvent,
	AgentSessionRuntime,
	SessionManager,
} from "@earendil-works/pi-coding-agent";

import { assertEquals, assertRejects, waitForCondition } from "#testing/assertions";

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
	sessionEntryStub,
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
		getProvider: () => undefined,
		getProviders: () => [],
		hasConfiguredAuth: () => false,
		listCredentials: () => Promise.resolve([]),
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
		extensionRunner: {
			getRegisteredCommands: () => [],
			getShortcuts: () => new Map(),
		},
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
		reload: async (options?: { beforeSessionStart?: () => void | Promise<void> }) => {
			fake.reloadCount += 1;
			await options?.beforeSessionStart?.();
			// Like the SDK, reloaded extensions re-run `session_start` through the bound UI context.
			fake.extensionBindings
				.at(-1)
				?.uiContext?.setStatus("reloaded", "after reload");
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

async function activate(
	state: AppStore,
	runtimes: RuntimeFake[],
	workspace = "/workspace",
): Promise<RuntimeController> {
	const controller = await RuntimeController.prepare(state, workspace, {
		dependencies: dependencies(runtimes),
	});
	controller.activate();
	return controller;
}

function streamingRuntimes(): [RuntimeFake, RuntimeFake] {
	const a = fakeRuntime("/sessions/a.jsonl");
	const b = fakeRuntime("/sessions/b.jsonl");
	a.setStreaming(true);
	b.setStreaming(true);
	return [a, b];
}

async function expectSourceRestored(
	controller: RuntimeController,
	state: AppStore,
	source: RuntimeFake,
	replacement: RuntimeFake,
): Promise<void> {
	assertEquals(state.workspacePath, "/work/source");
	assertEquals(source.disposeCount, 0);
	assertEquals(replacement.disposeCount, 1);
	await controller.dispose();
	assertEquals(source.disposeCount, 1);
}

test("RuntimeController abort preserves the live transcript and interrupted reply", async () => {
	const state = new AppStore();
	const fake = fakeRuntime();
	const controller = await RuntimeController.create(state, "/workspace", {
		dependencies: dependencies([fake]),
	});
	try {
		state.appendMessage("tool", "- removed\n+ added", {
			format: "diff",
			state: "success",
		});
		state.appendAssistantDelta("partial **reply**");
		const messages = [...state.messages];
		fake.runtime.session.abort = async () => {
			fake.emit(
				agentSessionEventStub({
					type: "message_end",
					message: { role: "assistant", stopReason: "aborted" },
				}),
			);
			fake.emit(agentSessionEventStub({ type: "agent_settled" }));
		};

		await controller.abort();

		assertEquals(state.messages, messages);
		assertEquals(state.transcript.activeAssistantMessageId, undefined);
	} finally {
		await controller.dispose();
	}
});

test("RuntimeController restores queued messages to the editor after abort", async () => {
	const state = new AppStore();
	const fake = fakeRuntime();
	const controller = await activate(state, [fake], "/workspace");
	fake.setStreaming(true);
	fake.emit(
		agentSessionEventStub({
			type: "queue_update",
			steering: ["steer first"],
			followUp: ["follow up"],
		}),
	);
	assertEquals(state.queuedSteeringMessages, ["steer first"]);
	state.setPromptEditorText("my draft");

	await controller.abort();

	assertEquals(state.queuedSteeringMessages, []);
	assertEquals(state.queuedFollowUpMessages, []);
	assertEquals(state.promptEditorText, "steer first\n\nfollow up\n\nmy draft");
	assertEquals(fake.promptInputs, []);
	await controller.dispose();
});

test("RuntimeController production path binds callbacks before activation", async () => {
	const fake = fakeRuntime();
	const controller = await RuntimeController.prepare(new AppStore(), "/workspace", {
		dependencies: dependencies([fake]),
	});
	assertEquals(fake.calls, ["create", "bindExtensions"]);
	// Default binding (R4-A, O1): "tui" unlocks custom()/component/ctx.mode ===
	// "tui" gated extension behavior via pi-ui's terminal-surface host.
	assertEquals(fake.extensionBindings[0]?.mode, "tui");
	assertEquals(Boolean(fake.extensionBindings[0]?.uiContext), true);
	assertEquals(fake.beforeInvalidate.length, 1);
	assertEquals(fake.rebind.length, 1);
	controller.activate();
	assertEquals(fake.calls.filter((call) => call === "subscribe").length, 1);
	await controller.dispose();
	assertEquals(fake.calls.filter((call) => call === "unsubscribe").length, 1);
	assertEquals(fake.disposeCount, 1);
});

test('RuntimeController extensionsMode: "rpc" is an escape hatch back to the pre-Round-4 binding', async () => {
	const fake = fakeRuntime();
	const controller = await RuntimeController.prepare(new AppStore(), "/workspace", {
		dependencies: dependencies([fake]),
		extensionsMode: "rpc",
	});
	assertEquals(fake.extensionBindings[0]?.mode, "rpc");
	await controller.dispose();
});

test("RuntimeController opens tree commands without prompting the model", async () => {
	const state = new AppStore();
	const fake = fakeRuntime();
	const controller = await activate(state, [fake], "/workspace");
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
	const controller = await activate(new AppStore(), [fake], "/workspace");

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
	const controller = await activate(new AppStore(), [fake], "/workspace");
	const calls = [...fake.calls];

	assertEquals(await controller.resumeSession("/sessions/a.jsonl"), {
		status: "success",
	});
	assertEquals(fake.calls, calls);
	await controller.dispose();
});

test("RuntimeController renames the active pi session", async () => {
	const fake = fakeRuntime("/sessions/current.jsonl");
	const controller = await activate(new AppStore(), [fake], "/workspace");

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
	const controller = await activate(store, [fake], "/workspace");

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
	const controller = await activate(store, [fake], "/workspace");

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
	const controller = await activate(store, [fake], "/workspace");
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

// Each `session.bindExtensions()` call unconditionally re-emits `session_start`
// (the SDK's own behavior — see `agent-session.js`'s `bindExtensions()`), so
// counting `bindExtensions` calls is exactly counting `session_start`
// deliveries. These regression tests cover every session transition: a
// transition that binds extensions twice here would deliver `session_start`
// to every extension twice for real.
function bindExtensionsCount(fake: RuntimeFake): number {
	return fake.calls.filter((call) => call === "bindExtensions").length;
}

test("RuntimeController delivers session_start exactly once for /new from an idle saved session", async () => {
	const fake = fakeRuntime("/sessions/a.jsonl"); // persisted, idle: the in-place path.
	const store = new AppStore();
	const controller = await activate(store, [fake], "/workspace");
	// Like the SDK's in-place `newSession()`: invalidate, replace the session,
	// then run the rebind callback — all before `newSession()` resolves.
	fake.runtime.newSession = async () => {
		await fake.beforeInvalidate.at(-1)?.();
		fake.runtime.session.sessionManager.getSessionFile = () => "/sessions/new.jsonl";
		await fake.rebind.at(-1)?.();
		return { cancelled: false };
	};
	const before = bindExtensionsCount(fake);

	assertEquals((await controller.newSession()).status, "success");

	assertEquals(bindExtensionsCount(fake) - before, 1);
	// The final bind stays live, not just present.
	fake.extensionBindings.at(-1)?.uiContext?.setStatus("after-new", "still live");
	assertEquals(store.extensionStatuses, [{ key: "after-new", text: "still live" }]);
	await controller.dispose();
});

test("RuntimeController delivers session_start exactly once for /new that replaces an active runtime", async () => {
	const foreground = fakeRuntime("/sessions/a.jsonl");
	const replacement = fakeRuntime("/sessions/b.jsonl");
	foreground.setStreaming(true);
	const controller = await activate(
		new AppStore(),
		[foreground, replacement],
		"/workspace",
	);

	assertEquals((await controller.newSession()).status, "success");

	assertEquals(bindExtensionsCount(replacement), 1);
	await controller.dispose();
});

test("RuntimeController delivers session_start exactly once for a new temporary session", async () => {
	const current = fakeRuntime("/sessions/a.jsonl");
	const temporary = fakeRuntime(undefined, false);
	const controller = await activate(new AppStore(), [current, temporary], "/workspace");

	assertEquals((await controller.newTemporarySession()).status, "success");

	assertEquals(bindExtensionsCount(temporary), 1);
	await controller.dispose();
});

test("RuntimeController delivers session_start exactly once for an in-place session switch", async () => {
	const fake = fakeRuntime("/sessions/a.jsonl");
	const controller = await activate(new AppStore(), [fake], "/workspace");
	fake.runtime.switchSession = async (sessionPath) => {
		await fake.beforeInvalidate.at(-1)?.();
		fake.runtime.session.sessionManager.getSessionFile = () => sessionPath;
		await fake.rebind.at(-1)?.();
		return { cancelled: false };
	};
	const before = bindExtensionsCount(fake);

	assertEquals(await controller.resumeSession("/sessions/b.jsonl"), {
		status: "success",
	});

	assertEquals(bindExtensionsCount(fake) - before, 1);
	await controller.dispose();
});

test("RuntimeController delivers session_start exactly once for a resume that replaces an active runtime", async () => {
	const foreground = fakeRuntime("/sessions/a.jsonl");
	const replacement = fakeRuntime("/sessions/b.jsonl");
	foreground.setStreaming(true);
	const controller = await activate(
		new AppStore(),
		[foreground, replacement],
		"/workspace",
	);

	assertEquals(await controller.resumeSession("/sessions/b.jsonl"), {
		status: "success",
	});

	assertEquals(bindExtensionsCount(replacement), 1);
	await controller.dispose();
});

test("RuntimeController delivers session_start exactly once for /fork", async () => {
	const fake = fakeRuntime("/sessions/a.jsonl");
	const controller = await activate(new AppStore(), [fake], "/workspace");
	fake.runtime.fork = async (entryId, options) => {
		void entryId;
		void options;
		await fake.beforeInvalidate.at(-1)?.();
		fake.runtime.session.sessionManager.getSessionFile = () => "/sessions/fork.jsonl";
		await fake.rebind.at(-1)?.();
		return { cancelled: false };
	};
	const actions = fake.extensionBindings.at(-1)?.commandContextActions;
	if (!actions) throw new Error("missing extension command context actions");
	const before = bindExtensionsCount(fake);

	assertEquals(await actions.fork("entry-1", {}), { cancelled: false });

	assertEquals(bindExtensionsCount(fake) - before, 1);
	await controller.dispose();
});

test("RuntimeController delivers session_start exactly once for /clone", async () => {
	const fake = fakeRuntime("/sessions/a.jsonl");
	const store = new AppStore();
	const controller = await activate(store, [fake], "/workspace");
	fake.runtime.switchSession = async (sessionPath) => {
		await fake.beforeInvalidate.at(-1)?.();
		fake.runtime.session.sessionManager.getSessionFile = () => sessionPath;
		await fake.rebind.at(-1)?.();
		return { cancelled: false };
	};
	const before = bindExtensionsCount(fake);

	assertEquals(await controller.prompt("/clone"), true);
	await new Promise((resolve) => setTimeout(resolve, 0));

	assertEquals(bindExtensionsCount(fake) - before, 1);
	assertEquals(store.messages.at(-1)?.text, "Session cloned.");
	await controller.dispose();
});

test("RuntimeController delivers session_start exactly once for /import", async () => {
	const fake = fakeRuntime("/sessions/a.jsonl");
	const store = new AppStore();
	const controller = await activate(store, [fake], "/workspace");
	fake.runtime.switchSession = async (sessionPath) => {
		await fake.beforeInvalidate.at(-1)?.();
		fake.runtime.session.sessionManager.getSessionFile = () => sessionPath;
		await fake.rebind.at(-1)?.();
		return { cancelled: false };
	};
	const importPath = join(tmpdir(), `pi-ui-import-${crypto.randomUUID()}.jsonl`);
	await Bun.write(importPath, "");
	const before = bindExtensionsCount(fake);

	assertEquals(await controller.prompt(`/import ${importPath}`), true);
	await new Promise((resolve) => setTimeout(resolve, 0));

	assertEquals(bindExtensionsCount(fake) - before, 1);
	await controller.dispose();
});

test("RuntimeController does not re-bind extensions for /reload (the SDK's own session_start suffices)", async () => {
	const fake = fakeRuntime("/sessions/a.jsonl");
	const controller = await activate(new AppStore(), [fake], "/workspace");
	const before = bindExtensionsCount(fake);

	assertEquals(await controller.reload(), true);

	assertEquals(bindExtensionsCount(fake) - before, 0);
	assertEquals(fake.reloadCount, 1);
	await controller.dispose();
});

test("RuntimeController disposal awaits and attempts foreground and background runtimes", async () => {
	const foreground = fakeRuntime();
	const replacement = fakeRuntime("/sessions/b.jsonl");
	foreground.setStreaming(true);
	const controller = await activate(
		new AppStore(),
		[foreground, replacement],
		"/workspace",
	);
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
	const controller = await activate(state, [fake], "/workspace");
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
	const controller = await activate(state, [fake], "/workspace");

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
	const controller = await activate(state, [fake], "/workspace");

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

test("RuntimeController keeps extension UI that reloaded extensions set during /reload", async () => {
	const state = new AppStore();
	const fake = fakeRuntime();
	const controller = await activate(state, [fake], "/workspace");
	fake.extensionBindings.at(-1)?.uiContext?.setStatus("stale", "before reload");

	assertEquals(await controller.prompt("/reload"), true);
	await new Promise((resolve) => setTimeout(resolve, 0));

	assertEquals(state.extensionStatuses, [{ key: "reloaded", text: "after reload" }]);
	await controller.dispose();
});

test("RuntimeController shows prompts queued during compaction and sends them afterward", async () => {
	const state = new AppStore();
	const fake = fakeRuntime();
	const controller = await activate(state, [fake], "/workspace");
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
	const controller = await activate(state, [fake], "/workspace");
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

test("RuntimeController create activates event handling and keeps activity visible through retries", async () => {
	const state = new AppStore();
	const runtime = fakeRuntime("/sessions/running.jsonl");
	const controller = await RuntimeController.create(state, "/workspace", {
		dependencies: dependencies([runtime]),
	});

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
	const [a, b] = streamingRuntimes();
	const controller = await activate(state, [a, b]);
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

test("RuntimeController keeps a backgrounded session's PIUI elements and restores them on re-foreground (A#23)", async () => {
	const state = new AppStore();
	const [a, b] = streamingRuntimes();
	const controller = await activate(state, [a, b]);
	const uiA = a.extensionBindings[0]?.uiContext;
	if (!uiA) throw new Error("missing uiContext for runtime a");

	uiA.notify(
		`PIUI ${JSON.stringify({
			v: 1,
			op: "set",
			el: {
				id: "panel",
				ns: "advisor",
				kind: "panel",
				placement: "sheet",
				title: "v1",
			},
		})}`,
		"info",
	);
	assertEquals(state.extensionElements.length, 1);
	assertEquals(state.extensionElements[0]?.title, "v1");

	// Backgrounding `a` (switching foreground to `b`) must not show `a`'s
	// elements under `b`, but must not discard them either.
	assertEquals(await controller.resumeSession("/sessions/b.jsonl"), {
		status: "success",
	});
	assertEquals(state.extensionElements, []);

	// The backgrounded runtime's own extension keeps updating its element —
	// this must be captured even though `a` is not currently foreground.
	uiA.notify(
		`PIUI ${JSON.stringify({
			v: 1,
			op: "set",
			el: {
				id: "panel",
				ns: "advisor",
				kind: "panel",
				placement: "sheet",
				title: "v2",
			},
		})}`,
		"info",
	);
	assertEquals(state.extensionElements, []);

	// Re-foregrounding `a` restores its latest elements, not an empty view.
	assertEquals(await controller.resumeSession("/sessions/a.jsonl"), {
		status: "success",
	});
	assertEquals(state.extensionElements.length, 1);
	assertEquals(state.extensionElements[0]?.title, "v2");

	await controller.dispose();
});

test("RuntimeController cancels a pending extension dialog on session switch", async () => {
	const state = new AppStore();
	const [a, b] = streamingRuntimes();
	const controller = await activate(state, [a, b]);
	const uiA = a.extensionBindings[0]?.uiContext;
	if (!uiA) throw new Error("missing uiContext for runtime a");

	const selected = uiA.select("Pick one", ["x", "y"]);
	assertEquals(state.extensionDialog?.kind, "select");

	assertEquals(await controller.resumeSession("/sessions/b.jsonl"), {
		status: "success",
	});

	// The dialog left pending on the now-backgrounded runtime resolves as
	// cancelled instead of hanging forever, and the foreground view (now
	// `b`'s) no longer shows it.
	assertEquals(await selected, undefined);
	assertEquals(state.extensionDialog, undefined);

	await controller.dispose();
});

test("RuntimeController tracks the previous session for alternate jumps", async () => {
	const state = new AppStore();
	const [a, b] = streamingRuntimes();
	const controller = await activate(state, [a, b]);
	assertEquals(state.currentSessionPath, "/sessions/a.jsonl");
	assertEquals(state.previousSessionPath, undefined);

	assertEquals(await controller.resumeSession("/sessions/b.jsonl"), {
		status: "success",
	});
	assertEquals(state.currentSessionPath, "/sessions/b.jsonl");
	assertEquals(state.previousSessionPath, "/sessions/a.jsonl");

	assertEquals(await controller.resumeSession("/sessions/a.jsonl"), {
		status: "success",
	});
	assertEquals(state.currentSessionPath, "/sessions/a.jsonl");
	assertEquals(state.previousSessionPath, "/sessions/b.jsonl");
	await controller.dispose();
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
	const controller = await activate(state, [source, replacement], "/work/source");

	assertEquals(await controller.openWorkspace("/work/replacement"), true);
	assertEquals(state.workspacePath, "/work/replacement");
	assertEquals(source.disposeCount, 0);
	assertEquals(source.calls.filter((call) => call === "unsubscribe").length, 1);
	// openWorkspace() binds extensions on its own call site (runtime-controller.ts,
	// separate from bindSessionExtensions()) — must honor the same configured mode.
	assertEquals(replacement.extensionBindings[0]?.mode, "tui");

	assertEquals(await controller.resumeSession("/sessions/source.jsonl"), {
		status: "success",
	});
	await expectSourceRestored(controller, state, source, replacement);
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
	const controller = await activate(state, [source, replacement], "/work/source");

	await assertRejects(
		() => controller.openWorkspace("/work/replacement"),
		Error,
		"bind failed",
	);
	await expectSourceRestored(controller, state, source, replacement);
});

test("RuntimeController disposes an idle session on workspace change", async () => {
	const source = fakeRuntime("/sessions/source.jsonl", true, "/work/source");
	const replacement = fakeRuntime(
		"/sessions/replacement.jsonl",
		true,
		"/work/replacement",
	);
	const controller = await activate(
		new AppStore(),
		[source, replacement],
		"/work/source",
	);

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
	const controller = await activate(
		new AppStore(),
		[source, replacement],
		"/workspace",
	);

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
	const controller = await activate(
		new AppStore(),
		[temporary, replacement],
		"/workspace",
	);
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

for (const abortFails of [false, true]) {
	test(`RuntimeController waits for temporary disposal before replacement, abort failure: ${abortFails}`, async () => {
		const temporary = fakeRuntime(undefined, false);
		const replacement = fakeRuntime("/sessions/replacement.jsonl");
		temporary.setStreaming(true);
		if (abortFails) {
			temporary.runtime.session.abort = () => {
				temporary.calls.push("abort");
				return Promise.reject(new Error("abort failed"));
			};
		}
		const started = Promise.withResolvers<void>();
		const released = Promise.withResolvers<void>();
		temporary.disposeResult = released.promise;
		const dispose = temporary.runtime.dispose.bind(temporary.runtime);
		temporary.runtime.dispose = () => {
			started.resolve();
			return dispose();
		};
		const controller = await activate(
			new AppStore(),
			[temporary, replacement],
			"/workspace",
		);
		const transition = controller.newSession();
		try {
			await started.promise;
			assertEquals(temporary.calls.slice(-3), ["unsubscribe", "abort", "dispose"]);
			assertEquals(replacement.calls.includes("create"), false);
			released.resolve();
			assertEquals(await transition, { status: "success" });
			assertEquals(replacement.calls.includes("subscribe"), true);
		} finally {
			released.resolve();
			await transition;
			await controller.dispose();
		}
	});
}

test("RuntimeController does not create a replacement when departure disposal fails", async () => {
	const source = fakeRuntime(undefined, false);
	const replacement = fakeRuntime("/sessions/replacement.jsonl");
	const controller = await activate(
		new AppStore(),
		[source, replacement],
		"/workspace",
	);
	source.disposeError = new Error("dispose failed");
	try {
		assertEquals(await controller.newSession(), { status: "error" });
		assertEquals(replacement.calls.includes("create"), false);
	} finally {
		source.disposeError = undefined;
		await controller.dispose();
	}
});

test("RuntimeController adopts a prepared workspace despite idle disposal failure", async () => {
	const source = fakeRuntime("/sessions/source.jsonl", true, "/work/source");
	const replacement = fakeRuntime(
		"/sessions/replacement.jsonl",
		true,
		"/work/replacement",
	);
	const state = new AppStore();
	const controller = await activate(state, [source, replacement], "/work/source");
	source.disposeError = new Error("dispose failed");
	try {
		assertEquals(await controller.openWorkspace("/work/replacement"), true);
		assertEquals(state.workspacePath, "/work/replacement");
	} finally {
		source.disposeError = undefined;
		await controller.dispose();
	}
});

test("RuntimeController completes and aborts background runtimes exactly once", async () => {
	const completed = fakeRuntime("/sessions/completed.jsonl");
	const foreground = fakeRuntime("/sessions/foreground.jsonl");
	completed.setStreaming(true);
	const controller = await activate(
		new AppStore(),
		[completed, foreground],
		"/workspace",
	);
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

test("RuntimeController opens the command palette for /settings and /hotkeys without prompting the model", async () => {
	for (const name of ["/settings", "/hotkeys"]) {
		const fake = fakeRuntime();
		const controller = await activate(new AppStore(), [fake], "/workspace");
		assertEquals(await controller.prompt(name), true);
		assertEquals(fake.promptInputs, []);
		await controller.dispose();
	}
});

test("RuntimeController opens the session picker for /resume without prompting the model", async () => {
	const fake = fakeRuntime();
	const controller = await activate(new AppStore(), [fake], "/workspace");
	assertEquals(await controller.prompt("/resume"), true);
	assertEquals(fake.promptInputs, []);
	await controller.dispose();
});

test("RuntimeController shows session stats for /session without prompting the model", async () => {
	const state = new AppStore();
	const fake = fakeRuntime("/sessions/a.jsonl");
	fake.runtime.session.getSessionStats = () => ({
		sessionFile: "/sessions/a.jsonl",
		sessionId: "session-id",
		userMessages: 2,
		assistantMessages: 3,
		toolCalls: 4,
		toolResults: 4,
		totalMessages: 9,
		tokens: { input: 10, output: 20, cacheRead: 0, cacheWrite: 0, total: 30 },
		cost: 0.125,
	});
	const controller = await activate(state, [fake], "/workspace");

	assertEquals(await controller.prompt("/session"), true);
	assertEquals(fake.promptInputs, []);
	const text = state.messages.at(-1)?.text ?? "";
	assertEquals(text.includes("2 user, 3 assistant, 4 tool calls"), true);
	assertEquals(text.includes("$0.1250"), true);
	await controller.dispose();
});

test("RuntimeController reports the current thinking level for a bare /thinking", async () => {
	const state = new AppStore();
	const fake = fakeRuntime();
	const controller = await activate(state, [fake], "/workspace");

	assertEquals(await controller.prompt("/thinking"), true);
	await new Promise((resolve) => setTimeout(resolve, 0));

	assertEquals(fake.promptInputs, []);
	assertEquals(
		state.messages.at(-1)?.text.includes("Current thinking level: off"),
		true,
	);
	await controller.dispose();
});

test("RuntimeController rejects an invalid /thinking level without prompting the model", async () => {
	const state = new AppStore();
	const fake = fakeRuntime();
	const controller = await activate(state, [fake], "/workspace");

	assertEquals(await controller.prompt("/thinking turbo"), true);
	await new Promise((resolve) => setTimeout(resolve, 0));

	assertEquals(fake.promptInputs, []);
	assertEquals(
		state.messages.at(-1)?.text.includes("Invalid thinking level: turbo"),
		true,
	);
	await controller.dispose();
});

test("RuntimeController rejects a syntactically valid /thinking level the session doesn't offer", async () => {
	// "high" is a real AppThinkingLevel, unlike "turbo" above — the bug this
	// guards was reporting success for any recognized level name even when
	// the session's own getAvailableThinkingLevels() (here: only "off") didn't
	// include it.
	const state = new AppStore();
	const fake = fakeRuntime();
	const controller = await activate(state, [fake], "/workspace");

	assertEquals(await controller.prompt("/thinking high"), true);
	await new Promise((resolve) => setTimeout(resolve, 0));

	assertEquals(fake.promptInputs, []);
	assertEquals(
		state.messages.at(-1)?.text.includes("Invalid thinking level: high"),
		true,
	);
	await controller.dispose();
});

test("RuntimeController opens the model picker for a bare /model, without prompting the model", async () => {
	const state = new AppStore();
	const fake = fakeRuntime();
	const controller = await activate(state, [fake], "/workspace");
	state.setModels(
		[
			{
				id: "opus",
				provider: "anthropic",
				name: "Claude Opus",
				configured: true,
				scoped: false,
			},
		],
		"anthropic/opus",
	);
	let opened = false;
	state.requestOpenModelPicker = () => {
		opened = true;
	};

	assertEquals(await controller.prompt("/model"), true);
	await new Promise((resolve) => setTimeout(resolve, 0));

	assertEquals(fake.promptInputs, []);
	assertEquals(opened, true);
	await controller.dispose();
});

test("RuntimeController opens the login dialog for /model when no model is available", async () => {
	const state = new AppStore();
	const fake = fakeRuntime();
	const controller = await activate(state, [fake], "/workspace");
	state.setModels([], undefined);
	let pickerOpened = false;
	state.requestOpenModelPicker = () => {
		pickerOpened = true;
	};
	let loginOpened = 0;
	controller.openLogin = () => {
		loginOpened += 1;
	};

	assertEquals(await controller.prompt("/model"), true);
	assertEquals(await controller.prompt("/scoped-models"), true);
	await new Promise((resolve) => setTimeout(resolve, 0));

	assertEquals(fake.promptInputs, []);
	assertEquals(pickerOpened, false);
	assertEquals(loginOpened, 2);
	await controller.dispose();
});

test("RuntimeController opens the model picker for /scoped-models, without prompting the model", async () => {
	const state = new AppStore();
	const fake = fakeRuntime();
	const controller = await activate(state, [fake], "/workspace");
	state.setModels(
		[
			{
				id: "opus",
				provider: "anthropic",
				name: "Claude Opus",
				configured: true,
				scoped: true,
			},
			{
				id: "gpt-5",
				provider: "openai",
				name: "GPT-5",
				configured: true,
				scoped: false,
			},
		],
		"anthropic/opus",
	);
	let opened = false;
	state.requestOpenModelPicker = () => {
		opened = true;
	};

	assertEquals(await controller.prompt("/scoped-models"), true);
	await new Promise((resolve) => setTimeout(resolve, 0));

	assertEquals(fake.promptInputs, []);
	assertEquals(opened, true);
	await controller.dispose();
});

test("RuntimeController requires a title for /name and reports temporary sessions cannot be renamed", async () => {
	const state = new AppStore();
	const fake = fakeRuntime();
	const controller = await activate(state, [fake], "/workspace");

	assertEquals(await controller.prompt("/name"), true);
	await new Promise((resolve) => setTimeout(resolve, 0));
	assertEquals(fake.promptInputs, []);
	assertEquals(state.messages.at(-1)?.text, "Usage: /name <title>");

	fake.runtime.session.sessionManager.getSessionFile = () => undefined;
	assertEquals(await controller.prompt("/name new title"), true);
	await new Promise((resolve) => setTimeout(resolve, 0));
	assertEquals(fake.promptInputs, []);
	assertEquals(state.messages.at(-1)?.text, "Temporary sessions cannot be renamed.");
	await controller.dispose();
});

test("RuntimeController renames the session for /name <title> without prompting the model", async () => {
	const state = new AppStore();
	const fake = fakeRuntime("/sessions/current.jsonl");
	const controller = await activate(state, [fake], "/workspace");

	assertEquals(await controller.prompt("/name  My Session  "), true);
	// The rename refreshes the session catalog with a real `fs.stat`, which can take more
	// than one macrotask under full-suite load, so wait for the confirmation instead.
	await waitForCondition(
		() => state.messages.at(-1)?.text?.startsWith("Session renamed") ?? false,
		{
			timeoutMs: 2_000,
			message: "/name never confirmed the rename",
		},
	);

	assertEquals(fake.promptInputs, []);
	assertEquals(fake.setSessionNames, ["My Session"]);
	// Previously silent: confirm the rename so the command gives feedback.
	assertEquals(state.messages.at(-1)?.text, 'Session renamed to "My Session".');
	await controller.dispose();
});

test("RuntimeController reports nothing-to-copy when the client forwards a failed /copy", async () => {
	// The client (pickers.tsx / prompt-box.tsx) only ever posts "/copy" to the
	// server after its own clipboard copy failed — see static/app/pickers.js.
	const state = new AppStore();
	const fake = fakeRuntime();
	const controller = await activate(state, [fake], "/workspace");

	assertEquals(await controller.prompt("/copy"), true);
	await new Promise((resolve) => setTimeout(resolve, 0));

	assertEquals(fake.promptInputs, []);
	assertEquals(state.messages.at(-1)?.text, "Nothing to copy yet.");

	// The client reports a clipboard failure (API missing/denied and the execCommand
	// fallback failed too) as "/copy unavailable" — a distinct, visible notice.
	assertEquals(await controller.prompt("/copy unavailable"), true);
	await new Promise((resolve) => setTimeout(resolve, 0));
	assertEquals(
		state.messages.at(-1)?.text,
		"Couldn't copy: this browser blocked clipboard access.",
	);
	await controller.dispose();
});

test("RuntimeController includes the matching changelog entry for /changelog", async () => {
	const state = new AppStore();
	const fake = fakeRuntime();
	const controller = await activate(state, [fake], "/workspace");

	assertEquals(await controller.prompt("/changelog"), true);
	await new Promise((resolve) => setTimeout(resolve, 0));

	assertEquals(fake.promptInputs, []);
	const notice = state.messages.at(-1);
	assertEquals(notice?.format, "pre");
	assertEquals(notice?.text.startsWith("## ["), true);
	await controller.dispose();
});

test("RuntimeController reports /bug and /quit as unsupported without prompting the model", async () => {
	const state = new AppStore();
	const fake = fakeRuntime();
	const controller = await activate(state, [fake], "/workspace");

	assertEquals(await controller.prompt("/bug"), true);
	assertEquals(await controller.prompt("/quit"), true);
	assertEquals(fake.promptInputs, []);
	assertEquals(state.messages.length, 2);
	await controller.dispose();
});

test("RuntimeController confirms a successful /clone (round-4 O5)", async () => {
	const state = new AppStore();
	const source = fakeRuntime("/sessions/source.jsonl");
	const cloned = fakeRuntime("/sessions/fork.jsonl");
	// A non-streaming, persisted source takes `executeSessionResume`'s in-place
	// `switchSession` branch instead (not covered by any test fixture here), so mark it
	// streaming to exercise the same open-a-new-runtime path `forkSessionToWorkspace`'s test
	// does, and consume the second fixture.
	source.setStreaming(true);
	const controller = await activate(state, [source, cloned], "/workspace");

	assertEquals(await controller.prompt("/clone"), true);
	await new Promise((resolve) => setTimeout(resolve, 0));

	assertEquals(source.promptInputs, []);
	assertEquals(state.currentSessionPath, "/sessions/fork.jsonl");
	assertEquals(state.messages.at(-1)?.text, "Session cloned.");
	await controller.dispose();
});

test("RuntimeController reports temporary sessions cannot be cloned without prompting the model", async () => {
	const state = new AppStore();
	const fake = fakeRuntime();
	fake.runtime.session.sessionManager.getSessionFile = () => undefined;
	const controller = await activate(state, [fake], "/workspace");

	assertEquals(await controller.prompt("/clone"), true);
	await new Promise((resolve) => setTimeout(resolve, 0));

	assertEquals(fake.promptInputs, []);
	assertEquals(state.messages.at(-1)?.text, "Temporary sessions cannot be cloned.");
	await controller.dispose();
});

test("RuntimeController opens the login dialog for /login without prompting the model", async () => {
	const state = new AppStore();
	const fake = fakeRuntime();
	const controller = await activate(state, [fake], "/workspace");

	assertEquals(await controller.prompt("/login"), true);
	assertEquals(fake.promptInputs, []);
	assertEquals(state.authDialog?.mode, "login");
	await controller.dispose();
});

test("RuntimeController opens the logout dialog for /logout without prompting the model", async () => {
	const state = new AppStore();
	const fake = fakeRuntime();
	const controller = await activate(state, [fake], "/workspace");

	assertEquals(await controller.prompt("/logout"), true);
	assertEquals(fake.promptInputs, []);
	assertEquals(state.authDialog?.mode, "logout");
	await controller.dispose();
});

test("RuntimeController requires a path for /import without prompting the model", async () => {
	const state = new AppStore();
	const fake = fakeRuntime();
	const controller = await activate(state, [fake], "/workspace");

	assertEquals(await controller.prompt("/import"), true);
	await new Promise((resolve) => setTimeout(resolve, 0));

	assertEquals(fake.promptInputs, []);
	assertEquals(state.messages.at(-1)?.text, "Usage: /import <path to .jsonl file>");
	await controller.dispose();
});

test("RuntimeController rejects /import of a missing file instead of starting a new session there", async () => {
	const state = new AppStore();
	const fake = fakeRuntime();
	const controller = await activate(state, [fake], "/workspace");
	const missing = join(tmpdir(), `pi-ui-missing-${crypto.randomUUID()}.jsonl`);

	assertEquals(await controller.prompt(`/import ${missing}`), true);
	await new Promise((resolve) => setTimeout(resolve, 0));

	assertEquals(fake.promptInputs, []);
	assertEquals(state.currentSessionPath, "/sessions/a.jsonl");
	assertEquals(state.messages.at(-1)?.noticeTone, "error");
	await controller.dispose();
});

test("RuntimeController starts a new session for /new without prompting the model", async () => {
	const state = new AppStore();
	const fake = fakeRuntime("/sessions/current.jsonl");
	const controller = await activate(state, [fake], "/workspace");

	assertEquals(await controller.prompt("/new"), true);
	await new Promise((resolve) => setTimeout(resolve, 0));

	assertEquals(fake.promptInputs, []);
	// The new session's welcome empty state is the confirmation; no notice hides it.
	assertEquals(state.messages.length, 0);
	await controller.dispose();
});

test("RuntimeController reports an unrecognized slash command without sending it to the model", async () => {
	const state = new AppStore();
	const fake = fakeRuntime();
	const controller = await activate(state, [fake], "/workspace");

	assertEquals(await controller.prompt("/not-a-real-command with args"), true);

	assertEquals(fake.promptInputs, []);
	assertEquals(
		state.messages.at(-1)?.text,
		"Unknown command: /not-a-real-command. Type / to see available commands.",
	);
	await controller.dispose();
});

test("RuntimeController sends a prompt that starts with a file path to the model", async () => {
	const state = new AppStore();
	const fake = fakeRuntime();
	const controller = await activate(state, [fake], "/workspace");

	assertEquals(await controller.prompt("/Users/me/app.ts fails to compile"), true);

	assertEquals(fake.promptInputs, [
		{ text: "/Users/me/app.ts fails to compile", streamingBehavior: undefined },
	]);
	await controller.dispose();
});

test("RuntimeController forwards a registered extension slash command to the model", async () => {
	const state = new AppStore();
	const fake = fakeRuntime();
	fake.runtime.session.extensionRunner.getRegisteredCommands = () => [
		{
			name: "custom",
			invocationName: "custom",
			description: "Custom command",
			sourceInfo: {
				path: "/extensions/custom.ts",
				source: "custom",
				scope: "project",
				origin: "top-level",
			},
			handler: async () => {},
		},
	];
	const controller = await activate(state, [fake], "/workspace");

	assertEquals(await controller.prompt("/custom do the thing"), true);

	assertEquals(fake.promptInputs, [
		{ text: "/custom do the thing", streamingBehavior: undefined },
	]);
	await controller.dispose();
});

test("RuntimeController forwards a mixed-case extension slash command instead of reporting it unknown", async () => {
	const state = new AppStore();
	const fake = fakeRuntime();
	fake.runtime.session.extensionRunner.getRegisteredCommands = () => [
		{
			name: "FixtureCmd",
			invocationName: "FixtureCmd",
			description: "Mixed-case command",
			sourceInfo: {
				path: "/extensions/fixture.ts",
				source: "fixture",
				scope: "project",
				origin: "top-level",
			},
			handler: async () => {},
		},
	];
	const controller = await activate(state, [fake], "/workspace");

	assertEquals(await controller.prompt("/FixtureCmd hello"), true);

	assertEquals(fake.promptInputs, [
		{ text: "/FixtureCmd hello", streamingBehavior: undefined },
	]);
	await controller.dispose();
});

test("RuntimeController hides the internal pi_ui_event reverse channel from the slash catalog", async () => {
	const state = new AppStore();
	const fake = fakeRuntime();
	const sourceInfo = {
		path: "/extensions/bridge.ts",
		source: "bridge",
		scope: "project" as const,
		origin: "top-level" as const,
	};
	fake.runtime.session.extensionRunner.getRegisteredCommands = () => [
		{
			name: "pi_ui_event",
			invocationName: "pi_ui_event",
			description: "Internal bridge",
			sourceInfo,
			handler: async () => {},
		},
		{
			name: "visible",
			invocationName: "visible",
			description: "Visible command",
			sourceInfo,
			handler: async () => {},
		},
	];
	const controller = await activate(state, [fake], "/workspace");

	const names = state.slashCommands.map((command) => command.name);
	assertEquals(names.includes("pi_ui_event"), false);
	assertEquals(names.includes("visible"), true);
	await controller.dispose();
});

test("RuntimeController rejects /export targets that name a directory", async () => {
	const state = new AppStore();
	const fake = fakeRuntime("/sessions/current.jsonl");
	const controller = await activate(state, [fake], "/workspace");

	for (const target of ["..", ".", "../.."]) {
		assertEquals(await controller.prompt(`/export ${target}`), true);
		await new Promise((resolve) => setTimeout(resolve, 0));
		assertEquals(
			state.messages.at(-1)?.text.startsWith("Usage: /export"),
			true,
			target,
		);
	}
	assertEquals(fake.promptInputs, []);
	await controller.dispose();
});

test("RuntimeController renders a background session's custom entries with that session's own renderers", async () => {
	const state = new AppStore();
	const [a, b] = streamingRuntimes();
	const controller = await activate(state, [a, b]);
	const rendered: string[] = [];
	a.runtime.session.extensionRunner.getEntryRenderer = (customType) =>
		customType === "demo"
			? (entry) => {
					rendered.push(`a:${entry.id}`);
					return { render: () => ["from a"], invalidate: () => {} };
				}
			: undefined;
	b.runtime.session.extensionRunner.getEntryRenderer = () => () => {
		rendered.push("b");
		return { render: () => ["from b"], invalidate: () => {} };
	};

	// Foreground `b`; `a` keeps streaming in the background.
	assertEquals(await controller.resumeSession("/sessions/b.jsonl"), {
		status: "success",
	});
	a.emit(
		agentSessionEventStub({
			type: "entry_appended",
			entry: sessionEntryStub({ type: "custom", customType: "demo", id: "e1" }),
		}),
	);

	assertEquals(rendered, ["a:e1"]);
	// Nothing from the background session reaches the foreground transcript.
	assertEquals(state.messages, []);
	await controller.dispose();
});

test("RuntimeController keeps extension UI live after an in-place session switch", async () => {
	const state = new AppStore();
	const fake = fakeRuntime("/sessions/a.jsonl");
	const controller = await activate(state, [fake], "/workspace");
	// Like the SDK: invalidate, swap the session, then run the rebind callback.
	fake.runtime.switchSession = async (sessionPath) => {
		await fake.beforeInvalidate.at(-1)?.();
		fake.runtime.session.sessionManager.getSessionFile = () => sessionPath;
		await fake.rebind.at(-1)?.();
		return { cancelled: false };
	};

	assertEquals(await controller.resumeSession("/sessions/b.jsonl"), {
		status: "success",
	});
	assertEquals(state.currentSessionPath, "/sessions/b.jsonl");
	// The resumed session's extensions talk to the UI through the context bound during rebind.
	fake.extensionBindings.at(-1)?.uiContext?.setStatus("resumed", "still live");
	assertEquals(state.extensionStatuses, [{ key: "resumed", text: "still live" }]);
	await controller.dispose();
});

test("RuntimeController renders same-millisecond custom messages of one type with their own content", async () => {
	const state = new AppStore();
	const fake = fakeRuntime("/sessions/a.jsonl");
	const controller = await activate(state, [fake]);
	fake.runtime.session.extensionRunner.getMessageRenderer = (customType) =>
		customType === "memory-info"
			? (message) => ({
					render: () => [`body:${String(message.content)}`],
					invalidate: () => {},
				})
			: undefined;
	const timestamp = 1_700_000_000_000;
	for (const content of ["first", "second"]) {
		fake.emit(
			agentSessionEventStub({
				type: "message_start",
				message: {
					role: "custom",
					customType: "memory-info",
					content,
					display: true,
					timestamp,
				},
			}),
		);
	}

	assertEquals(
		state.messages.map((message) => message.customRenderHtml),
		[["body:first"], ["body:second"]],
	);
	await controller.dispose();
});
