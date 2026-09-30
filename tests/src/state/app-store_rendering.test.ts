import { afterEach, test } from "bun:test";

import { attributesToString } from "@kitajs/html";

import { DatastarClientHub } from "#src/server/datastar-client-hub.ts";
import { AppStore } from "#src/state/app-store.ts";
import {
	type TranscriptMessageInput,
	TranscriptState,
} from "#src/state/transcript-state.ts";
import { projectBackendSignals } from "#src/ui/backend-signals.ts";
import { renderMarkdownFinal } from "#src/ui/markdown.tsx";
import type { MessageRenderServiceOptions } from "#src/ui/message-render-service.ts";
import { renderPage } from "#src/ui/page.tsx";
import { UiRenderer } from "#src/ui/ui-renderer.ts";
import {
	assertEquals as assertEqual,
	assertStringIncludes as assertIncludes,
} from "#testing/assertions";

import { assertStringExcludes as assertNotIncludes } from "../testing/assertions.ts";
import { readUntil, responseReader } from "../testing/streams.ts";

const timestamp = new Date("2026-01-01T00:00:00.000Z");

test("restored messages are readable before final highlighting finishes", async () => {
	const gates: Array<(html: string) => void> = [];
	const render = () => new Promise<string>((resolve) => gates.push(resolve));
	const state = createState({ renderMarkdownFinal: render, renderCode: render });
	const controller = new AbortController();
	try {
		const reader = await openInitializedStateStream(state, controller.signal);
		state.replaceMessages([
			{
				role: "assistant",
				text: "**answer**",
				timestamp,
			},
			{
				role: "tool",
				text: "tool output",
				timestamp,
				format: "code",
			},
		]);
		const fallback = await readUntil(
			reader,
			(text) =>
				text.includes("<strong>answer</strong>") && text.includes("message-tool"),
		);
		assertNotIncludes(fallback, "data-enhanced");
		while (gates.length < 2) await Promise.resolve();
		gates.forEach((resolve, index) =>
			resolve(`<div data-enhanced="${index}">safe</div>`),
		);
		await readUntil(
			reader,
			(text) =>
				text.includes('data-enhanced="0"') && text.includes('data-enhanced="1"'),
		);
	} finally {
		controller.abort();
	}
});

test("ordinary commits exclude finalized assistant messages", async () => {
	const gate = gatedMarkdownState();
	const { state } = gate;
	const controller = new AbortController();
	try {
		const response = state.createStream(controller.signal);
		state.replaceMessages([markdownMessage("lightweight source")]);
		while (!gate.ready) await Promise.resolve();
		gate.resolve("<p>large finalized HTML</p>");
		const { finalized, ordinary } = await collectFinalizedPatches(
			state,
			response,
			"large finalized HTML",
		);
		assertIncludes(finalized, "data-ignore-morph");
		assertNotIncludes(ordinary, "large finalized HTML");
		assertNotIncludes(ordinary, "lightweight source");
		assertNotIncludes(ordinary, 'id="messages"');
	} finally {
		controller.abort();
	}
});

test("ordinary commits exclude finalized tool messages", async () => {
	const state = createState({
		renderDiff: () =>
			Promise.resolve('<div data-pierre-diff="">highlighted edit</div>'),
	});
	const controller = new AbortController();
	try {
		const response = state.createStream(controller.signal);
		state.replaceMessages([
			{
				role: "tool",
				text: "@@ -1 +1 @@\n-old\n+new",
				timestamp,
				format: "diff",
			},
		]);
		const { ordinary } = await collectFinalizedPatches(
			state,
			response,
			"highlighted edit",
		);
		assertNotIncludes(ordinary, "highlighted edit");
		assertNotIncludes(ordinary, 'id="messages"');
	} finally {
		controller.abort();
	}
});

test("new messages append to the stable message list", async () => {
	const state = createState();
	const controller = new AbortController();
	try {
		const reader = await openInitializedStateStream(state, controller.signal);
		state.appendMessage("user", "first");
		const first = await readUntil(reader, (text) => text.includes("first"));
		assertIncludes(first, "data: selector #messages");

		state.appendMessage("tool", "one", { format: "output", state: "running" });
		state.appendMessage("tool", "two", { format: "output", state: "running" });
		const tools = await readUntil(
			reader,
			(text) => text.includes("one") && text.includes("two"),
		);
		assertIncludes(tools, "data: selector #message-list");
		assertIncludes(tools, "data: mode append");
		assertIncludes(tools, "window.piUi.messageScroll.trimOldMessages()");
		assertNotIncludes(tools, '<main id="messages"');
	} finally {
		controller.abort();
	}
});

test("parallel message updates all reach their final state", async () => {
	const state = createState();
	const controller = new AbortController();
	try {
		const reader = await openInitializedStateStream(state, controller.signal);
		state.appendMessage("user", "first");
		await readUntil(reader, (text) => text.includes("first"));
		const firstId = state.appendMessage("tool", "", {
			title: "read",
			format: "pre",
			state: "running",
		});
		const secondId = state.appendMessage("tool", "", {
			title: "read",
			format: "pre",
			state: "running",
		});
		await readUntil(
			reader,
			(text) => text.includes(firstId) && text.includes(secondId),
		);

		state.updateMessage(firstId, { title: "read first.ts", state: "success" });
		state.updateMessage(secondId, { title: "read second.ts", state: "success" });
		const updates = await readUntil(
			reader,
			(text) => text.includes("read first.ts") && text.includes("read second.ts"),
		);

		assertEqual(count(updates, "data: selector [data-message-id="), 2);
		assertEqual(count(updates, "tool-status-success"), 2);
	} finally {
		controller.abort();
	}
});

test("session transitions preserve targeted transcript replacement and ordinary presentation", async () => {
	const state = createState();
	const controller = new AbortController();
	try {
		const reader = await openInitializedStateStream(state, controller.signal);

		state.setSessionTransition({
			status: "loading",
			generation: 1,
			targetPath: "/session.jsonl",
			overlay: true,
		});
		await readUntil(reader, (text) =>
			text.includes('"_sessionTransitionStatus":"loading"'),
		);

		state.replaceMessages([{ role: "user", text: "restored transcript", timestamp }]);
		state.flush();
		const restored = await readUntil(
			reader,
			(text) =>
				text.includes("restored transcript") &&
				text.includes('id="prompt-action"') &&
				text.includes("datastar-patch-signals"),
		);
		assertIncludes(restored, 'id="messages"');
		assertIncludes(restored, "data: selector #messages");
		assertIncludes(restored, "data: mode replace");

		state.setSessionTransition({ status: "idle", generation: 1 });
		await readUntil(reader, (text) =>
			text.includes('"_sessionTransitionStatus":"idle"'),
		);
	} finally {
		controller.abort();
	}
});

test("loading older pages enqueues only newly revealed messages", async () => {
	let renderCount = 0;
	const state = createState({
		renderMarkdownFinal: (text) => {
			renderCount += 1;
			return Promise.resolve(`<p>${text}</p>`);
		},
	});
	connect(state);
	state.replaceMessages(
		Array.from({ length: 60 }, (_, index) => markdownMessage(`**message ${index}**`)),
	);
	await waitFor(() => renderCount === 30);
	const ids = state.loadOlderMessages();
	assertEqual(ids.length, 30);
	state.renderer.patchOlderMessages(ids);
	await waitFor(() => renderCount === 60);
	assertEqual(state.loadOlderMessages(), []);
	const immediatePage = state.renderer.messages.renderMessagesElement();
	assertIncludes(immediatePage, "<strong>message 0</strong>");
	assertNotIncludes(immediatePage, "**message 0**");
	assertEqual(renderCount, 60);
});

test("theme changes highlight only loaded messages and invalidate older cached pages", async () => {
	let theme = "before";
	const rendered: string[] = [];
	const state = createState({
		renderMarkdownFinal: async (text) => {
			rendered.push(text);
			return `<p>${theme}: ${text}</p>`;
		},
	});
	connect(state);
	state.replaceMessages(
		Array.from({ length: 100 }, (_, index) => markdownMessage(`message ${index}`)),
	);
	await waitFor(() => rendered.length === 30);
	state.renderer.patchOlderMessages(state.loadOlderMessages());
	await waitFor(() => rendered.length === 60);
	await settleMicrotasks();
	state.showRecentMessages();
	assertEqual(state.messages.length, 30);

	theme = "after";
	rendered.length = 0;
	state.renderer.codeThemeChanged();
	state.flush();
	await waitFor(() =>
		projectedMessages(state).every(
			({ presentationState }) => presentationState === "final",
		),
	);
	assertEqual(rendered.toSorted(), state.messages.map(({ text }) => text).toSorted());

	state.renderer.patchOlderMessages(state.loadOlderMessages());
	await waitFor(() =>
		projectedMessages(state).every(
			({ presentationState }) => presentationState === "final",
		),
	);
	assertEqual(rendered.length, 60);
	assertEqual(
		projectedMessages(state).every(({ renderedHtml }) =>
			renderedHtml?.includes("after:"),
		),
		true,
	);
});

test("older messages insert after the trigger before rearming it", async () => {
	const state = stateWithMessages(130);
	const controller = new AbortController();
	try {
		const reader = await openInitializedStateStream(state, controller.signal);

		const ids = state.loadOlderMessages();
		assertEqual(ids.length, 30);
		state.renderer.patchOlderMessages(ids);
		const output = await readUntil(
			reader,
			(text) =>
				text.includes("window.piUi.messageScroll.restoreAnchor()") &&
				text.includes('id="older-messages-trigger"'),
		);

		assertIncludes(output, "data: selector #older-messages-trigger");
		assertIncludes(output, "data: mode after");
		assertIncludes(output, 'id="older-messages-trigger"');
		assertIncludes(output, "message 70");
		assertNotIncludes(output, "message 69");
		assertNotIncludes(output, 'id="messages"');
		assertIncludes(output, "window.piUi.messageScroll.restoreAnchor()");
	} finally {
		controller.abort();
	}
});

test("trimming removes old DOM messages with one structural selector", async () => {
	const state = stateWithMessages(130);
	const controller = new AbortController();
	try {
		const reader = await openInitializedStateStream(state, controller.signal);
		for (let page = 0; page < 3; page += 1) {
			const messages = state.loadOlderMessages();
			state.renderer.patchOlderMessages(messages);
			await readUntil(reader, (text) =>
				text.includes("window.piUi.messageScroll.restoreAnchor()"),
			);
		}
		const ids = state.trimOldMessages();
		state.renderer.messagesRemoved(ids.length);
		const output = await readUntil(reader, (text) => text.includes("mode remove"));

		assertEqual(ids.length, 20);
		assertEqual(state.messages.length, 100);
		assertIncludes(
			output,
			"data: selector #message-list > [data-message-id]:nth-last-child(n + 101)",
		);
		assertNotIncludes(output, '[data-message-id="m-');
	} finally {
		controller.abort();
	}
});

test("repaging replaces the transcript and moves to the recent page", async () => {
	const state = createState();
	state.replaceMessages(
		Array.from({ length: 80 }, (_, index) => ({
			role: "user" as const,
			text: `message ${index}`,
			timestamp,
		})),
	);
	state.loadOlderMessages();
	const controller = new AbortController();
	try {
		const reader = await openInitializedStateStream(state, controller.signal);

		state.showRecentMessages();
		const output = await readUntil(reader, (text) =>
			text.includes("window.piUi.messageScroll.scrollBottom()"),
		);

		assertIncludes(output, 'id="messages"');
		assertIncludes(output, 'id="older-messages-trigger"');
		assertIncludes(output, "message 50");
	} finally {
		controller.abort();
	}
});

test("replacement discards stale enhancement completion", async () => {
	const { state, gates } = gatedEnhancementQueue();
	connect(state);
	state.replaceMessages([markdownMessage("session A")]);
	while (gates.length < 1) await Promise.resolve();
	state.replaceMessages([markdownMessage("session B")]);
	gates[0].resolve("<p>stale A</p>");
	while (gates.length < 2) await Promise.resolve();
	gates[1].resolve("<p>final B</p>");
	await settleMicrotasks();

	assertEqual(state.messages.length, 1);
	assertEqual(state.messages[0].text, "session B");
	assertEqual(projectedMessages(state)[0].renderedHtml, "<p>final B</p>");
	assertEqual(projectedMessages(state)[0].presentationState, "final");
});

for (const message of [
	{ role: "assistant" },
	{ role: "thought" },
	{ role: "tool", format: "code" },
	{ role: "tool", format: "diff" },
] as const) {
	test(`oversized ${message.role === "tool" ? message.format : message.role} automatically finishes highlighting`, async () => {
		let finish: ((html: string) => void) | undefined;
		const render = () =>
			new Promise<string>((resolve) => {
				finish = resolve;
			});
		const state = createState({
			renderMarkdownFinal: render,
			renderCode: render,
			renderDiff: render,
		});
		connect(state);
		state.replaceMessages([
			{ ...message, text: "large fallback ".repeat(3_000), timestamp },
		]);
		await waitFor(() => finish !== undefined);
		assertEqual(projectedMessages(state)[0].presentationState, "enhancing");
		const interim = state.renderer.messages.renderMessagesElement();
		let text = "";
		await new HTMLRewriter()
			.on("main", {
				text(chunk) {
					text += chunk.text;
				},
			})
			.transform(new Response(interim))
			.text();
		assertIncludes(text, "large fallback");
		assertNotIncludes(interim, "Enhance formatting");
		finish?.("<p>highlighting finished</p>");
		await settleMicrotasks();
		assertEqual(projectedMessages(state)[0].presentationState, "final");
		assertIncludes(
			state.renderer.messages.renderMessagesElement(),
			"highlighting finished",
		);
	});
}

test("skill and compaction instructions render Markdown without enhancement work", async () => {
	let renderCount = 0;
	const state = createState({
		renderMarkdownFinal: () => {
			renderCount += 1;
			return Promise.resolve("<p>enhanced</p>");
		},
	});
	connect(state);
	state.replaceMessages([
		{ role: "skill", text: "**Skill instructions**", timestamp },
		{ role: "compaction", text: "**Compaction summary**", timestamp },
	]);
	await settleMicrotasks();

	assertEqual(renderCount, 0);
	assertIncludes(projectedMessages(state)[0].renderedHtml ?? "", "<strong>");
	assertIncludes(projectedMessages(state)[1].renderedHtml ?? "", "<strong>");
});

test("assistant completion immediately flushes newest streaming content", () => {
	const state = createState();
	connect(state);
	state.appendMessage("assistant", "first");
	state.appendAssistantDelta(" **latest**");
	state.finishAssistant();
	assertIncludes(
		projectedMessages(state)[0].renderedHtml ?? "",
		"<strong>latest</strong>",
	);
});

test("running background transcript restores streaming state and queued messages", async () => {
	let enhancementCount = 0;
	const background = new TranscriptState({ keys: "N", description: "New" });
	background.appendAssistantDelta("```ts\nconst partial = true");
	background.appendMessage("tool", "still running", {
		state: "running",
		format: "code",
	});
	background.setQueuedMessages(["steer"], ["follow"]);

	const foreground = createState({
		renderMarkdownFinal: (text) => {
			enhancementCount += 1;
			return Promise.resolve(`<p>${text}</p>`);
		},
		renderCode: (text) => {
			enhancementCount += 1;
			return Promise.resolve(`<pre>${text}</pre>`);
		},
	});
	connect(foreground);
	foreground.restoreChat(background.snapshot());
	await settleMicrotasks();

	assertEqual(enhancementCount, 1);
	assertEqual(projectedMessages(foreground)[0].presentationState, "streaming");
	assertIncludes(projectedMessages(foreground)[0].renderedHtml ?? "", "partial");
	assertEqual(foreground.messages[1].state, "running");
	assertEqual(foreground.queuedSteeringMessages.join(","), "steer");
	assertEqual(foreground.queuedFollowUpMessages.join(","), "follow");
});

test("AppStore transcript metadata has one owner and restores with chat", () => {
	const state = createState();
	state.setActivityText("Working...");
	state.setQueuedMessages(["steer"], ["follow"]);
	const snapshot = state.snapshotChat();

	state.setActivityText(undefined);
	state.setQueuedMessages([], []);
	state.restoreChat(snapshot);

	assertEqual(state.activityText, "Working...");
	assertEqual(state.queuedSteeringMessages.join(","), "steer");
	assertEqual(state.queuedFollowUpMessages.join(","), "follow");
	// SAFETY: The test deliberately attempts to mutate the runtime copy behind its readonly API.
	const steering = state.queuedSteeringMessages as string[];
	steering.push("external mutation");
	assertEqual(state.queuedSteeringMessages.join(","), "steer");
});

test("completed background transcript enhances on activation", async () => {
	let enhancementCount = 0;
	const background = new TranscriptState({ keys: "N", description: "New" });
	background.appendAssistantDelta("completed **answer**");
	background.finishAssistant();

	const foreground = createState({
		renderMarkdownFinal: () => {
			enhancementCount += 1;
			return Promise.resolve("<p>enhanced</p>");
		},
	});
	connect(foreground);
	foreground.restoreChat(background.snapshot());
	await waitFor(() => projectedMessages(foreground)[0]?.presentationState === "final");
	assertEqual(enhancementCount, 1);
});

test("enhancement errors retain the rendered Markdown fallback", async () => {
	const originalWarn = console.warn;
	console.warn = () => {};
	try {
		const state = createState({
			renderMarkdownFinal: () => Promise.reject(new Error("render failed")),
		});
		connect(state);
		state.replaceMessages([markdownMessage("**fallback**")]);
		await settleMicrotasks();
		assertEqual(
			projectedMessages(state)[0].renderedHtml,
			"<p><strong>fallback</strong></p>\n",
		);
		assertEqual(projectedMessages(state)[0].presentationState, "plain");
		assertIncludes(
			state.renderer.messages.renderMessagesElement(),
			"<p><strong>fallback</strong></p>",
		);
	} finally {
		console.warn = originalWarn;
	}
});

test("a thrown update still commits its completed mutations", async () => {
	const state = createState();
	const controller = new AbortController();
	try {
		const reader = await openInitializedStateStream(state, controller.signal);
		try {
			state.update(() => {
				state.setWorkspacePath("/tmp/committed-before-throw");
				throw new Error("stop");
			});
		} catch {
			// The mutator error is expected; already-applied state remains authoritative.
		}
		assertEqual(state.workspacePath, "/tmp/committed-before-throw");
		await readUntil(reader, (text) => text.includes("/tmp/committed-before-throw"));
	} finally {
		controller.abort();
	}
});

test("headless updates initialize one current view and tolerate disconnect", async () => {
	let renderCount = 0;
	const state = createState({
		renderMarkdownFinal: (text) => {
			renderCount++;
			return renderMarkdownFinal(text);
		},
	});
	state.setWorkspacePath("/tmp/headless");
	const controller = new AbortController();
	const response = state.createStream(controller.signal);
	const reader = responseReader(response);
	await readElementAndSignalPatches(reader);

	controller.abort();
	state.setActivityText("disconnected");
	state.flush();
	assertEqual(state.activityText, "disconnected");

	state.replaceMessages([markdownMessage("**offline answer**")]);
	state.flush();
	await settleMicrotasks();
	assertEqual(renderCount, 0);

	const reconnect = new AbortController();
	try {
		const reader = responseReader(state.createStream(reconnect.signal));
		const output = await readUntil(reader, (text) =>
			text.includes("event: datastar-patch-signals"),
		);
		assertIncludes(output, "<strong>offline answer</strong>");
		assertEqual(count(output, "event: datastar-patch-elements"), 1);
		await waitFor(() => projectedMessages(state)[0].presentationState === "final");
		assertEqual(renderCount, 1);
	} finally {
		reconnect.abort();
	}
});

test("message work waits for a client and continues while another tab remains", async () => {
	const rendered: string[] = [];
	const render = async (text: string) => {
		rendered.push(text);
		return renderMarkdownFinal(text);
	};
	const state = createState({ renderMarkdownFinal: render, renderCode: render });
	state.appendAssistantDelta("offline answer");
	state.finishAssistant();
	const toolId = state.appendMessage("tool", "running", {
		format: "code",
		state: "running",
	});
	state.updateMessage(toolId, { text: "finished tool", state: "success" });
	state.flush();
	await settleMicrotasks();
	assertEqual(rendered, []);
	assertEqual(
		state.messages.map(({ text }) => text),
		["offline answer", "finished tool"],
	);

	const first = connect(state);
	await waitFor(() => rendered.length === 2);
	await settleMicrotasks();
	const second = connect(state);
	first.abort();
	state.appendAssistantDelta("one tab remains");
	state.finishAssistant();
	state.renderer.requestCommit();
	state.flush();
	await waitFor(() => rendered.includes("one tab remains"));
	assertEqual(rendered.length, 3);

	second.abort();
	state.appendAssistantDelta("offline again");
	state.finishAssistant();
	state.flush();
	await settleMicrotasks();
	assertEqual(rendered.length, 3);
});

test("reconnecting during a turn resumes streaming and final highlighting", async () => {
	const state = createState();
	state.appendAssistantDelta("before **connection** ");
	connect(state);
	assertEqual(projectedMessages(state)[0].presentationState, "streaming");
	state.appendAssistantDelta("and after");
	state.finishAssistant();
	state.flush();
	await waitFor(() => projectedMessages(state)[0].presentationState === "final");
	assertIncludes(
		projectedMessages(state)[0].renderedHtml ?? "",
		"before <strong>connection</strong> and after",
	);
});

test("last-client disconnect discards in-flight rendering before reconnect", async () => {
	const { state, gates } = gatedEnhancementQueue();
	const first = connect(state);
	state.replaceMessages([markdownMessage("old content")]);
	await waitFor(() => gates.length === 1);
	first.abort();
	state.updateMessage(state.messages[0].id, { text: "current content" });
	connect(state);
	gates[0].resolve("<p>stale rendering</p>");
	await waitFor(() => gates.length === 2);
	assertEqual(gates[1].text, "current content");
	assertNotIncludes(state.renderer.messages.renderMessagesElement(), "stale rendering");
	gates[1].resolve("<p>current rendering</p>");
	await waitFor(() => projectedMessages(state)[0].presentationState === "final");
	assertEqual(projectedMessages(state)[0].renderedHtml, "<p>current rendering</p>");
});

test("workspace review snapshots travel through the app stream", async () => {
	const state = createState();
	state.setWorkspaceReview({
		branch: "main",
		changes: ["new/a.txt", "new/b.txt"].map((path) => ({
			path,
			status: "untracked",
			additions: 0,
			deletions: 0,
		})),
		commits: [],
		isGitRepository: true,
		changeCount: 1,
		revision: "review-1",
	});
	state.flush();
	const output = await readStateOutput(
		state,
		(text) => text.includes("workspace-review-data") && text.includes("review-1"),
	);
	assertIncludes(output, '"branch":"main"');
	const signals = projectBackendSignals(state.snapshot());
	assertEqual(signals._workspaceReviewChangeCount, 1);
	assertEqual(signals._workspaceReviewStatsKnown, false);
	assertIncludes(output, 'id="workspace-review-data"');
	assertNotIncludes(output, 'id="workspace-review-data-region"');
});

test("title changes render escaped HTML on updates and reconnect, never executable scripts", async () => {
	const state = createState();
	const controller = new AbortController();
	try {
		const reader = await openInitializedStateStream(state, controller.signal);
		state.setDocumentTitle(
			"</title><script>globalThis.titleInjected = true</script>",
		);
		state.flush();
		const updated = await readUntil(reader, (text) =>
			text.includes('id="document-title"'),
		);
		assertIncludes(updated, "&lt;/title&gt;&lt;script&gt;");
		assertNotIncludes(updated, "<script>");
		assertNotIncludes(updated, "document.title =");
		const reconnect = await readStateOutput(state, (text) =>
			text.includes('id="document-title"'),
		);
		assertIncludes(reconnect, "&lt;/title&gt;&lt;script&gt;");
		assertNotIncludes(reconnect, "document.title =");
	} finally {
		controller.abort();
	}
});

test("app stream refreshes current and background session statuses", async () => {
	const state = createState();
	const controller = new AbortController();
	const first = {
		path: "/sessions/first.jsonl",
		cwd: "/workspace",
		title: "First session",
		messageCount: 1,
		modified: "now",
	};
	const second = {
		path: "/sessions/second.jsonl",
		cwd: "/workspace",
		title: "Second session",
		messageCount: 2,
		modified: "earlier",
	};
	try {
		const response = state.renderer.createStream(controller.signal);
		const reader = responseReader(response);
		await readUntil(reader, (text) => text.includes("event: datastar-patch-signals"));

		state.update(
			() => {
				state.setCurrentSessionPath(first.path);
				state.setActivityText("Working...");
				state.setSessionCatalog([first, second]);
			},
			{ flush: true },
		);
		const running = await readUntil(reader, (text) =>
			text.includes('aria-label="Current session running"'),
		);
		assertIncludes(running, 'id="session-menu-content"');
		assertIncludes(running, 'aria-current="true"');
		assertIncludes(running, "First session");

		state.update(
			() => {
				state.setCurrentSessionPath(second.path);
				state.setActivityText(undefined);
				state.setSessionCatalog([
					{ ...first, backgroundStatus: "completed" },
					second,
				]);
			},
			{ flush: true },
		);
		const completed = await readUntil(reader, (text) =>
			text.includes('aria-label="Background session completed"'),
		);
		assertIncludes(completed, 'id="session-menu-content"');
		assertIncludes(completed, 'aria-current="true"');
		assertNotIncludes(
			completed.slice(completed.lastIndexOf('id="session-menu-content"')),
			'aria-label="Current session running"',
		);
	} finally {
		controller.abort();
	}
});

test("ordinary commits do not project an unchanged transcript", async () => {
	const state = createState();
	state.replaceMessages([{ role: "assistant", text: "answer", timestamp }]);
	const controller = new AbortController();
	try {
		await openInitializedStateStream(state, controller.signal);
		const projectMessages = state.renderer.messages.projectMessages.bind(
			state.renderer.messages,
		);
		let projectionCount = 0;
		state.renderer.messages.projectMessages = (messages) => {
			projectionCount += 1;
			return projectMessages(messages);
		};

		state.update(() => state.setUsage({ text: "1 token", costText: "$0.00" }), {
			flush: true,
		});

		assertEqual(projectionCount, 0);
	} finally {
		controller.abort();
	}
});

test("state snapshots contain domain messages only", () => {
	const state = createState();
	state.appendMessage("assistant", "**answer**");

	const message = state.snapshot().messages[0];
	assertEqual("renderedHtml" in message, false);
	assertEqual("presentationState" in message, false);
	assertEqual("presentationVersion" in message, false);
	assertIncludes(projectedMessages(state)[0].renderedHtml ?? "", "<strong>");
});

test("initial page signals match live state after activity and session transitions", async () => {
	const state = createState();
	const cases = [
		() => {},
		() => state.setActivityText("Working..."),
		() =>
			state.setSessionTransition({
				status: "loading",
				generation: 1,
				targetPath: "/session.jsonl",
				overlay: true,
			}),
		() => {
			state.setModels([], "provider/model");
			state.setThinking("high", ["off", "high"]);
			state.setWorkspacePath("/tmp/workspace");
			state.setActivityText(undefined);
			state.setSessionTransition({ status: "idle", generation: 1 });
		},
	];
	for (const mutate of cases) {
		mutate();
		const snapshot = state.snapshot();
		let initialSignals: string | null = null;
		await new HTMLRewriter()
			.on("body", {
				element: (element) => {
					initialSignals = element.getAttribute("data-signals");
				},
			})
			.transform(new Response(renderPage(state.renderer.projectState(snapshot))))
			.text();
		// HTMLRewriter returns the encoded attribute, not its DOM-decoded value.
		assertEqual(
			` data-signals="${initialSignals}"`,
			attributesToString({
				"data-signals": state.renderer.renderSignals(snapshot),
			}),
		);
	}
});

test("server-owned view signals are transport-private", () => {
	const signals = projectBackendSignals(createState().snapshot());
	assertEqual(
		Object.keys(signals).filter((name) => !name.startsWith("_")),
		[],
	);
});

type TestStore = AppStore & {
	readonly renderer: UiRenderer;
	createStream(signal: AbortSignal): Response;
};

function createState(options: MessageRenderServiceOptions = {}): TestStore {
	const store = new AppStore();
	const renderer = new UiRenderer(store, new DatastarClientHub(), options);
	return Object.assign(store, {
		renderer,
		createStream: (signal: AbortSignal) => renderer.createStream(signal),
	});
}

function stateWithMessages(count: number): TestStore {
	const state = createState();
	state.replaceMessages(
		Array.from({ length: count }, (_, index) => ({
			role: "user" as const,
			text: `message ${index}`,
			timestamp,
		})),
	);
	return state;
}

function gatedMarkdownState() {
	let resolveEnhancement: ((html: string) => void) | undefined;
	const state = createState({
		renderMarkdownFinal: () =>
			new Promise<string>((resolve) => (resolveEnhancement = resolve)),
	});
	return {
		state,
		get ready(): boolean {
			return resolveEnhancement !== undefined;
		},
		resolve(html: string): void {
			resolveEnhancement?.(html);
		},
	};
}

function gatedEnhancementQueue() {
	const gates: Array<{ text: string; resolve: (html: string) => void }> = [];
	const state = createState({
		enhancementConcurrency: 1,
		renderMarkdownFinal: (text) =>
			new Promise<string>((resolve) => gates.push({ text, resolve })),
	});
	return { state, gates };
}

const connections: AbortController[] = [];
afterEach(() => {
	for (const controller of connections.splice(0)) controller.abort();
});

function connect(state: TestStore): AbortController {
	const controller = new AbortController();
	connections.push(controller);
	state.createStream(controller.signal);
	return controller;
}

function projectedMessages(state: TestStore) {
	return state.renderer.projectState(state.snapshot()).messages;
}

function markdownMessage(text: string): TranscriptMessageInput {
	return { role: "assistant", text, timestamp };
}

async function settleMicrotasks(): Promise<void> {
	for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

async function waitFor(complete: () => boolean): Promise<void> {
	for (let index = 0; index < 500; index += 1) {
		if (complete()) return;
		await Promise.resolve();
	}
	throw new Error("Expected asynchronous work did not complete");
}

async function openInitializedStateStream(
	state: TestStore,
	signal: AbortSignal,
): Promise<ReadableStreamDefaultReader<Uint8Array>> {
	const reader = responseReader(state.createStream(signal));
	await readUntil(reader, (text) => text.includes("event: datastar-patch-signals"));
	return reader;
}

async function readStateOutput(
	state: TestStore,
	complete: (text: string) => boolean,
): Promise<string> {
	const controller = new AbortController();
	connections.push(controller);
	return readUntil(responseReader(state.createStream(controller.signal)), complete);
}

async function readElementAndSignalPatches(
	reader: ReadableStreamDefaultReader<Uint8Array>,
): Promise<string> {
	const output = await readUntil(
		reader,
		(text) =>
			text.includes("event: datastar-patch-elements") &&
			text.includes("event: datastar-patch-signals"),
	);
	assertEqual(count(output, "event: datastar-patch-elements"), 1);
	assertEqual(count(output, "event: datastar-patch-signals"), 1);
	return output;
}

async function collectFinalizedPatches(
	state: TestStore,
	response: Response,
	finalText: string,
) {
	const reader = responseReader(response);
	const finalized = await readUntil(reader, (text) => text.includes(finalText));
	state.setUsage({ text: "$1.000 • 1 token", costText: "$1.000" });
	const ordinary = await readUntil(reader, (text) => text.includes("$1.000"));
	return { finalized, ordinary };
}

function count(value: string, search: string): number {
	return value.split(search).length - 1;
}
