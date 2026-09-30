import { test } from "bun:test";

import { newSessionAction } from "#src/commands/actions.ts";
import { DatastarClientHub } from "#src/server/datastar-client-hub.ts";
import { sessionTransitionResponse } from "#src/server/routes/sessions.ts";
import { AppStore } from "#src/state/app-store.ts";
import { renderMessages } from "#src/ui/messages.tsx";
import { renderSessionPicker } from "#src/ui/pickers.tsx";
import { renderSessionSidebar } from "#src/ui/session-sidebar.tsx";
import { renderSessionTransition } from "#src/ui/session-transition.tsx";
import { renderToolbar } from "#src/ui/toolbar.tsx";
import { UiRenderer } from "#src/ui/ui-renderer.ts";
import { assertEquals, assertStringIncludes } from "#testing/assertions";

import { assertStringExcludes } from "../testing/assertions.ts";
import { readUntil, responseReader } from "../testing/streams.ts";
import { appRenderSnapshot } from "../ui/test-fixtures.ts";
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
	const toolbar = renderToolbar(appRenderSnapshot({ isTemporarySession: false }));
	assertStringIncludes(toolbar, "data-indicator:_new-session-pending");
	assertStringIncludes(toolbar, "Review workspace");
	assertStringExcludes(toolbar, "data-indicator:_session-loading");
});

test("transcript loading starts with the request and ends with the backend transition", () => {
	const state = new AppStore();
	const transition = renderSessionTransition(state.snapshot());
	const messages = renderMessages([], { keys: "/", description: "Commands" });
	assertStringExcludes(transition, "$_sessionLoading || $_sessionTransitionVisible");
	assertStringExcludes(messages, "$_sessionLoading || $_sessionTransitionVisible");
	assertStringIncludes(messages, "data-class:messages-loading");
	assertStringIncludes(messages, "evt.detail.type === 'started'");
	assertStringExcludes(messages, "if ($_sessionLoading)");
	assertStringIncludes(messages, "$_sessionTransitionPending");
	assertStringIncludes(messages, "$_sessionTransitionStatus === 'loading'");
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
				messageCount: 1,
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
		messageCount: 1,
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
		assertStringIncludes(html, "$_sessionTransitionStatus");
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
	const { state, controller, read } = openTransitionStream();
	try {
		state.setSessionCatalog([
			{
				path: "/sessions/one.jsonl",
				cwd: "/workspace",
				title: "Fresh session",
				messageCount: 1,
				modified: "now",
			},
		]);
		state.setSessionTransition({ status: "idle", generation: 1 });

		const output = await read((text) => text.includes("Fresh session"));
		assertStringExcludes(output, "component.refresh");
	} finally {
		controller.abort();
	}
});

test("completed session transition scrolls the transcript to bottom", async () => {
	const { state, controller, read } = openTransitionStream();
	try {
		state.setSessionTransition({ status: "idle", generation: 1 });

		await read((text) => text.includes("messageScroll.scrollBottom()"));
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

function openTransitionStream() {
	const state = new AppStore();
	const renderer = new UiRenderer(state, new DatastarClientHub());
	const controller = new AbortController();
	const response = renderer.createStream(controller.signal);
	state.setSessionTransition({
		status: "loading",
		generation: 1,
		targetPath: "/sessions/one.jsonl",
		overlay: true,
	});
	return {
		state,
		controller,
		read: (complete: (text: string) => boolean) =>
			readUntil(
				responseReader(response),
				complete,
				"Expected transition stream output was not received",
			),
	};
}
