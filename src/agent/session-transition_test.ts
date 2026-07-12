import { DatastarClientHub } from "../server/datastar-client-hub.ts";
import { sessionTransitionResponse } from "../server/routes/sessions.ts";
import { AppStore } from "../state/app-store.ts";
import { renderMessages } from "../ui/messages.tsx";
import { renderSessionPicker } from "../ui/pickers.tsx";
import {
	renderSessionTransition,
	resumeSessionAction,
} from "../ui/session-transition.tsx";
import { UiRenderer } from "../ui/ui-renderer.ts";
import {
	classifySessionLeave,
	transitionRuntime,
	type SessionLeaveAction,
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
			const actual = classifySessionLeave(testCase);
			if (actual !== testCase.expected) {
				throw new Error(`Expected ${testCase.expected}, received ${actual}`);
			}
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
				dispose: () => events.push("dispose"),
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
	assertEvents(fake.events, ["unsubscribe", "abort", "dispose", "bind"]);
	if (fake.backgroundCount !== 0) throw new Error("temporary runtime was backgrounded");
});

Deno.test("abort rejection still disposes and binds replacement", async () => {
	const fake = lifecycle("discard", { rejectAbort: true });
	await fake.run();
	assertEvents(fake.events, ["unsubscribe", "abort", "abort-error", "dispose", "bind"]);
});

Deno.test("running persisted runtime is only backgrounded", async () => {
	const fake = lifecycle("background");
	await fake.run();
	assertEvents(fake.events, ["background", "bind"]);
});

Deno.test("idle replacement is disposed once", async () => {
	const fake = lifecycle("dispose");
	await fake.run();
	assertEvents(fake.events, ["unsubscribe", "dispose", "bind"]);
});

Deno.test("session transition renderer escapes targets and renders loading and errors", () => {
	const targetPath = '<session name="bad">';
	const loading = renderSessionTransition({
		sessionTransition: { status: "loading", generation: 1, targetPath },
	} as AppStore);
	if (!loading.includes('role="status"')) throw new Error("Missing loading status");
	if (!loading.includes("&lt;session name=&#34;bad&#34;>")) {
		throw new Error("Target path was not escaped");
	}
	if (loading.includes(targetPath)) throw new Error("Unsafe target path rendered");

	const error = renderSessionTransition({
		sessionTransition: {
			status: "error",
			generation: 2,
			targetPath,
			message: "Try another session.",
		},
	} as AppStore);
	if (!error.includes('role="alert"') || !error.includes("Try another session.")) {
		throw new Error("Missing recoverable transition error");
	}
});

Deno.test("shared resume action drives every immediate loading signal", () => {
	const action = resumeSessionAction("/sessions/one.json", { closeDialog: true });
	for (const expected of [
		"$_sessionLoading",
		"$sessionTransitionLoading",
		"$sessionPath",
		"/sessions/resume",
		"session-dialog",
	]) {
		if (!action.includes(expected)) throw new Error(`Missing ${expected}`);
	}
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
	const picker = renderSessionPicker({
		sessions: [session],
		currentSessionPath: undefined,
	} as AppStore);
	for (const html of [recent, picker]) {
		if (!html.includes("/sessions/resume")) throw new Error("Missing resume action");
		if (!html.includes("_sessionLoading")) throw new Error("Missing indicator");
		if (!html.includes("$sessionTransitionLoading")) {
			throw new Error("Missing disabled transition guard");
		}
	}
	if (!recent.includes("evt.ctrlKey")) throw new Error("Missing keyboard resume");
});

Deno.test("session picker command state morphs after a transition", async () => {
	const state = new AppStore();
	const renderer = new UiRenderer(state, new DatastarClientHub());
	const controller = new AbortController();
	try {
		const response = renderer.createStream(controller.signal);
		state.setSessionTransition({
			status: "loading",
			generation: 1,
			targetPath: "/sessions/one.jsonl",
		});
		state.setSessions([]);
		state.setSessionTransition({ status: "idle", generation: 1 });

		const output = await readUntil(
			response,
			(text) =>
				text.includes('id="session-menu"') &&
				text.includes('"sessionTransitionLoading":false'),
		);
		if (output.includes("component.refresh")) {
			throw new Error("Server emitted a legacy Basecoat refresh script");
		}
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
		const response = sessionTransitionResponse({ status });
		if (response.status !== expected) {
			throw new Error(`Expected ${expected}, received ${response.status}`);
		}
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

function assertEvents(actual: string[], expected: string[]): void {
	if (actual.join(",") !== expected.join(",")) {
		throw new Error(
			`Expected ${expected.join(" → ")}, received ${actual.join(" → ")}`,
		);
	}
}
