import { assertEquals, assertRejects, assertStringIncludes } from "@std/assert";

import { newSessionAction } from "../commands/actions.ts";
import { DatastarClientHub } from "../server/datastar-client-hub.ts";
import { sessionTransitionResponse } from "../server/routes/sessions.ts";
import { AppStore } from "../state/app-store.ts";
import { assertStringExcludes } from "../testing/assertions.ts";
import { renderMessages } from "../ui/messages.tsx";
import { renderSessionPicker } from "../ui/pickers.tsx";
import { renderPromptToolbar } from "../ui/prompt-toolbar.tsx";
import { renderSessionSidebar } from "../ui/session-sidebar.tsx";
import {
	renderSessionTransition,
	resumeSessionAction,
} from "../ui/session-transition.tsx";
import { appRenderSnapshot } from "../ui/test-fixtures.ts";
import { UiRenderer } from "../ui/ui-renderer.ts";
import {
	classifySessionLeave,
	type SessionLeaveAction,
	transitionRuntime,
} from "./session-transition.ts";

Deno.test("classify session leave policy", async (t) => {
	const cases: Array<{
		name: string;
		persisted: boolean;
		running: boolean;
		requiresNewRuntime: boolean;
		expected: SessionLeaveAction;
	}> = [
		{
			name: "running persisted",
			persisted: true,
			running: true,
			requiresNewRuntime: true,
			expected: "background",
		},
		{
			name: "running temporary",
			persisted: false,
			running: true,
			requiresNewRuntime: true,
			expected: "discard",
		},
		{
			name: "idle persisted replacement",
			persisted: true,
			running: false,
			requiresNewRuntime: true,
			expected: "dispose",
		},
		{
			name: "idle temporary replacement",
			persisted: false,
			running: false,
			requiresNewRuntime: true,
			expected: "dispose",
		},
		{
			name: "in-place persisted switch",
			persisted: true,
			running: false,
			requiresNewRuntime: false,
			expected: "keep",
		},
	];
	for (const testCase of cases) {
		await t.step(testCase.name, () => {
			assertEquals(classifySessionLeave(testCase), testCase.expected);
		});
	}
});

function lifecycle(action: SessionLeaveAction, options: { rejectAbort?: boolean } = {}) {
	const events: string[] = [];
	let backgroundCount = 0;
	return {
		events,
		get backgroundCount() {
			return backgroundCount;
		},
		run: () =>
			transitionRuntime({
				action,
				unsubscribe: () => events.push("unsubscribe"),
				abort: () => {
					events.push("abort");
					return options.rejectAbort
						? Promise.reject(new Error("failed"))
						: Promise.resolve();
				},
				dispose: () => {
					events.push("dispose");
				},
				background: () => {
					backgroundCount += 1;
					events.push("background");
				},
				bindReplacement: () => {
					events.push("bind");
				},
				onAbortError: () => events.push("abort-error"),
			}),
	};
}

Deno.test("discard orders unsubscribe, abort, dispose, and replacement bind", async () => {
	const fake = lifecycle("discard");
	await fake.run();
	assertEquals(fake.events, ["unsubscribe", "abort", "dispose", "bind"]);
	assertEquals(fake.backgroundCount, 0);
});

Deno.test("abort rejection still disposes and binds replacement", async () => {
	const fake = lifecycle("discard", { rejectAbort: true });
	await fake.run();
	assertEquals(fake.events, ["unsubscribe", "abort", "abort-error", "dispose", "bind"]);
});

Deno.test("replacement bind waits for delayed disposal", async () => {
	const events: string[] = [];
	let releaseDispose!: () => void;
	const disposal = new Promise<void>((resolve) => {
		releaseDispose = resolve;
	});
	const transition = transitionRuntime({
		action: "discard",
		unsubscribe: () => events.push("unsubscribe"),
		abort: () => {
			events.push("abort");
			return Promise.resolve();
		},
		dispose: () => {
			events.push("dispose");
			return disposal;
		},
		background: () => {},
		bindReplacement: () => {
			events.push("bind");
		},
	});
	await Promise.resolve();
	assertEquals(events, ["unsubscribe", "abort", "dispose"]);
	releaseDispose();
	await transition;
	assertEquals(events, ["unsubscribe", "abort", "dispose", "bind"]);
});

Deno.test("disposal rejection prevents replacement binding", async () => {
	const fake = lifecycle("dispose");
	fake.run = () =>
		transitionRuntime({
			action: "dispose",
			unsubscribe: () => fake.events.push("unsubscribe"),
			abort: () => Promise.resolve(),
			dispose: () => {
				fake.events.push("dispose");
				return Promise.reject(new Error("dispose failed"));
			},
			background: () => {},
			bindReplacement: () => {
				fake.events.push("bind");
			},
		});
	await assertRejects(fake.run, Error, "dispose failed");
	assertEquals(fake.events, ["unsubscribe", "dispose"]);
});

Deno.test("running persisted runtime is only backgrounded", async () => {
	const fake = lifecycle("background");
	await fake.run();
	assertEquals(fake.events, ["background", "bind"]);
});

Deno.test("idle replacement is disposed once", async () => {
	const fake = lifecycle("dispose");
	await fake.run();
	assertEquals(fake.events, ["unsubscribe", "dispose", "bind"]);
});

Deno.test("session transition renderer escapes targets and renders loading and errors", () => {
	const targetPath = '<session name="bad">';
	const loading = renderSessionTransition(
		appRenderSnapshot({
			sessionTransition: {
				status: "loading",
				generation: 1,
				targetPath,
				overlay: true,
			},
		}),
	);
	assertStringIncludes(loading, 'role="status"');
	assertStringIncludes(loading, "&lt;session name=&#34;bad&#34;>");
	assertStringExcludes(loading, targetPath);

	const quiet = renderSessionTransition(
		appRenderSnapshot({
			sessionTransition: {
				status: "loading",
				generation: 2,
				targetPath: "New session",
				overlay: false,
			},
		}),
	);
	assertStringIncludes(quiet, 'style="display: none"');

	const error = renderSessionTransition(
		appRenderSnapshot({
			sessionTransition: {
				status: "error",
				generation: 2,
				targetPath,
				message: "Try another session.",
			},
		}),
	);
	assertStringIncludes(error, 'role="alert"');
	assertStringIncludes(error, "Try another session.");
});

Deno.test("new session actions lock without driving the transition overlay", () => {
	const action = newSessionAction();
	assertStringIncludes(action, "$_newSessionPending");
	const toolbar = renderPromptToolbar(appRenderSnapshot({ isTemporarySession: false }));
	assertStringIncludes(toolbar, "data-indicator:_new-session-pending");
	assertStringIncludes(toolbar, "Review workspace");
	assertStringExcludes(toolbar, "data-indicator:_session-loading");
});

Deno.test("session request indicators lock controls without hiding the transcript", () => {
	const state = new AppStore();
	const transition = renderSessionTransition(state.snapshot());
	const messages = renderMessages([], { keys: "/", description: "Commands" });
	assertStringExcludes(transition, "$_sessionLoading || $_sessionTransitionVisible");
	assertStringExcludes(messages, "$_sessionLoading || $_sessionTransitionVisible");
	assertStringIncludes(messages, "data-class:opacity-50");
	assertStringIncludes(messages, "$_sessionLoading");
	assertStringIncludes(messages, "$_sessionTransitionLoading");
});

Deno.test("shared resume action drives every immediate loading signal", () => {
	const action = resumeSessionAction("/sessions/one.json", {
		closeDialog: true,
	});
	for (const expected of [
		"$_sessionLoading",
		"$_sessionTransitionLoading",
		'payload: { sessionPath: "/sessions/one.json" }',
		"/sessions/resume",
		"session-dialog",
	]) {
		assertStringIncludes(action, expected);
	}
});

Deno.test("empty chat shows login instead of recent sessions without auth", () => {
	const html = renderMessages(
		[],
		{ keys: "/", description: "Open commands" },
		false,
		[
			{
				path: "/sessions/one.json",
				cwd: "/workspace",
				title: "One",
				subtitle: "1 message",
				modified: "Today",
			},
		],
		false,
	);
	assertStringIncludes(html, "/login");
	assertStringIncludes(html, "/auth/open-login");
	assertStringExcludes(html, "Recent sessions");
	assertStringExcludes(html, "/sessions/resume");
});

Deno.test("resume renderers share loading behavior and disable controls", () => {
	const session = {
		path: "/sessions/one.json",
		cwd: "/workspace",
		title: "One",
		subtitle: "1 message",
		modified: "Today",
	};
	const recent = renderMessages([], { keys: "ctrl 1", description: "Resume" }, false, [
		session,
	]);
	const picker = renderSessionPicker(
		appRenderSnapshot({
			sessions: [session],
			currentSessionPath: undefined,
		}),
	);
	for (const html of [recent, picker]) {
		assertStringIncludes(html, "/sessions/resume");
		assertStringIncludes(html, "_sessionLoading");
		assertStringIncludes(html, "$_sessionTransitionLoading");
	}
	const shortcuts = renderSessionSidebar({
		sessions: [session],
		sessionSidebarSessions: [session],
		sessionSidebarHasMore: false,
		currentSessionPath: undefined,
		activityText: undefined,
		sessionCatalogLoading: false,
	});
	assertStringIncludes(shortcuts, "evt.ctrlKey");
});

Deno.test("session picker command state morphs on the app stream", async () => {
	const state = new AppStore();
	const renderer = new UiRenderer(state, new DatastarClientHub());
	const controller = new AbortController();
	try {
		const response = renderer.createStream(controller.signal);
		state.setSessionTransition({
			status: "loading",
			generation: 1,
			targetPath: "/sessions/one.jsonl",
			overlay: true,
		});
		state.setSessions([
			{
				path: "/sessions/one.jsonl",
				cwd: "/workspace",
				title: "Fresh session",
				subtitle: "1 message",
				modified: "now",
			},
		]);
		state.setSessionTransition({ status: "idle", generation: 1 });

		const output = await readUntil(response, (text) =>
			text.includes("Fresh session"),
		);
		assertStringExcludes(output, "component.refresh");
	} finally {
		controller.abort();
	}
});

Deno.test("completed session transition scrolls the transcript to bottom", async () => {
	const state = new AppStore();
	const renderer = new UiRenderer(state, new DatastarClientHub());
	const controller = new AbortController();
	try {
		const response = renderer.createStream(controller.signal);
		state.setSessionTransition({
			status: "loading",
			generation: 1,
			targetPath: "/sessions/one.jsonl",
			overlay: true,
		});
		state.setSessionTransition({ status: "idle", generation: 1 });

		await readUntil(response, (text) =>
			text.includes("messageScroll.scrollBottom()"),
		);
	} finally {
		controller.abort();
	}
});

Deno.test("session transition responses use meaningful statuses", () => {
	const cases = [
		["success", 204],
		["busy", 409],
		["cancelled", 422],
		["error", 500],
	] as const;
	for (const [status, expected] of cases) {
		assertEquals(sessionTransitionResponse({ status }).status, expected);
	}
});

async function readUntil(
	response: Response,
	complete: (text: string) => boolean,
): Promise<string> {
	const reader = response.body?.getReader();
	if (!reader) throw new Error("Missing response body");
	const decoder = new TextDecoder();
	let output = "";
	for (let index = 0; index < 30; index++) {
		const chunk = await reader.read();
		if (chunk.done) break;
		output += decoder.decode(chunk.value, { stream: true });
		if (complete(output)) return output;
	}
	throw new Error("Expected transition stream output was not received");
}
