import { test } from "bun:test";

import { assertEquals, assertStringIncludes } from "#testing/assertions";

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
test("session transition renderer escapes targets and renders loading and errors", () => {
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
	assertStringIncludes(loading, "&lt;session name=&quot;bad&quot;&gt;");
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

test("new session actions lock without driving the transition overlay", () => {
	const action = newSessionAction();
	assertStringIncludes(action, "$_newSessionPending");
	const toolbar = renderPromptToolbar(appRenderSnapshot({ isTemporarySession: false }));
	assertStringIncludes(toolbar, "data-indicator:_new-session-pending");
	assertStringIncludes(toolbar, "Review workspace");
	assertStringExcludes(toolbar, "data-indicator:_session-loading");
});

test("session request indicators lock controls without hiding the transcript", () => {
	const state = new AppStore();
	const transition = renderSessionTransition(state.snapshot());
	const messages = renderMessages([], { keys: "/", description: "Commands" });
	assertStringExcludes(transition, "$_sessionLoading || $_sessionTransitionVisible");
	assertStringExcludes(messages, "$_sessionLoading || $_sessionTransitionVisible");
	assertStringIncludes(messages, "data-class:messages-loading");
	assertStringIncludes(messages, "$_sessionLoading");
	assertStringIncludes(messages, "$_sessionTransitionLoading");
});

test("shared resume action drives every immediate loading signal", () => {
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

test("empty chat shows login instead of recent sessions without auth", () => {
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

test("resume renderers share loading behavior and disable controls", () => {
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
		sessionsHasMore: false,
		currentSessionPath: undefined,
		activityText: undefined,
		sessionCatalogLoading: false,
	});
	assertStringIncludes(shortcuts, "evt.ctrlKey");
});

test("session picker command state morphs on the app stream", async () => {
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
		state.setSessionCatalog([
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

test("completed session transition scrolls the transcript to bottom", async () => {
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

test("session transition responses use meaningful statuses", () => {
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
