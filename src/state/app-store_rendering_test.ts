import { afterEach, test } from "bun:test";

import { attributesToString } from "@kitajs/html";

import {
	assertEquals as assertEqual,
	assertStringIncludes as assertIncludes,
} from "#testing/assertions";

import { SessionCatalog } from "../agent/session-catalog.ts";
import type { PiUiElement } from "../extension-surface-types.ts";
import { emptyLiveWorkspaceSnapshot } from "../live-workspace-types.ts";
import { DatastarClientHub } from "../server/datastar-client-hub.ts";
import { assertStringExcludes as assertNotIncludes } from "../testing/assertions.ts";
import { collectElementPatches } from "../testing/element-patches.ts";
import { readUntil, responseReader } from "../testing/streams.ts";
import { projectBackendSignals } from "../ui/backend-signals.ts";
import { renderMarkdownFinal } from "../ui/markdown.tsx";
import type { MessageRenderServiceOptions } from "../ui/message-render-service.ts";
import { renderPage } from "../ui/page.tsx";
import { UiRenderer } from "../ui/ui-renderer.ts";
import { AppStore } from "./app-store.ts";
import { type TranscriptMessageInput, TranscriptState } from "./transcript-state.ts";

const timestamp = new Date("2026-01-01T00:00:00.000Z");

test("restored fallback content patches before bounded enhancements", async () => {
	const gates: Array<{ resolve: (html: string) => void }> = [];
	let active = 0;
	let maximum = 0;
	const order: string[] = [];
	const render = (kind: string) => {
		order.push(kind);
		active += 1;
		maximum = Math.max(maximum, active);
		return new Promise<string>((resolve) =>
			gates.push({
				resolve: (html) => {
					active -= 1;
					resolve(html);
				},
			}),
		);
	};
	const state = createState({
		enhancementConcurrency: 2,
		renderMarkdownFinal: () => render("markdown"),
		renderCode: () => render("tool"),
	});
	const controller = new AbortController();
	try {
		const response = state.createStream(controller.signal);
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
		const patchesPromise = collectElementPatches(response, 4);
		while (gates.length < 2) await Promise.resolve();
		for (const [index, gate] of gates.entries()) {
			gate.resolve(`<div data-enhanced="${index}">safe</div>`);
		}
		const summary = await patchesPromise;

		assertEqual(maximum, 2);
		assertEqual(order.join(","), "tool,markdown");
		assertEqual(summary.fullPatchCount, 1);
		assertEqual(summary.targetedPatchCount, 3);
		assertIncludes(summary.patches[1], "data: selector #messages");
		assertIncludes(summary.patches[1], "data: mode replace");
		assertIncludes(summary.patches[1], "<strong>answer</strong>");
		assertIncludes(summary.patches[1], "message-tool");
		assertNotIncludes(summary.patches[1], "data-enhanced");
		assertIncludes(summary.patches[2] + summary.patches[3], "data-enhanced");
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
		const patches = await collectFinalizedPatches(state, response);

		assertIncludes(patches.patches[2], "large finalized HTML");
		assertIncludes(patches.patches[2], "data-ignore-morph");
		assertNotIncludes(patches.patches[3], "large finalized HTML");
		assertNotIncludes(patches.patches[3], "lightweight source");
		assertNotIncludes(patches.patches[3], 'id="messages"');
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
		const patches = await collectFinalizedPatches(state, response);

		assertIncludes(patches.patches[2], "highlighted edit");
		assertNotIncludes(patches.patches[3], "highlighted edit");
		assertNotIncludes(patches.patches[3], 'id="messages"');
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

test("session transitions patch signals and replace only the transcript", async () => {
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
		const loading = await readUntil(reader, (text) =>
			text.includes('"_sessionTransitionStatus":"loading"'),
		);
		assertNotIncludes(loading, "datastar-patch-elements");

		state.replaceMessages([{ role: "user", text: "restored transcript", timestamp }]);
		state.flush();
		const restored = await readUntil(reader, (text) =>
			text.includes("restored transcript"),
		);
		assertIncludes(restored, 'id="messages"');
		assertIncludes(restored, "data: selector #messages");
		assertIncludes(restored, "data: mode replace");
		assertNotIncludes(restored, 'id="session-sidebar-content"');

		state.setSessionTransition({ status: "idle", generation: 1 });
		const idle = await readUntil(reader, (text) =>
			text.includes('"_sessionTransitionStatus":"idle"'),
		);
		assertNotIncludes(idle, "datastar-patch-elements");
	} finally {
		controller.abort();
	}
});

test("session loading clears after fallback and before enhancement", async () => {
	const gate = gatedMarkdownState();
	const { state } = gate;
	const controller = new AbortController();
	try {
		const response = state.createStream(controller.signal);
		const reader = responseReader(response);
		state.setSessionTransition({
			status: "loading",
			generation: 1,
			targetPath: "/session.jsonl",
			overlay: true,
		});
		state.replaceMessages([markdownMessage("content ready")]);
		state.setSessionTransition({ status: "idle", generation: 1 });
		const beforeEnhancement = await readUntil(reader, (text) => {
			const loading = text.indexOf('"_sessionTransitionStatus":"loading"');
			const fallback = text.indexOf("content ready", loading);
			return (
				loading >= 0 &&
				fallback > loading &&
				text.indexOf('"_sessionTransitionStatus":"idle"', fallback) > fallback
			);
		});
		const loading = beforeEnhancement.indexOf('"_sessionTransitionStatus":"loading"');
		const fallback = beforeEnhancement.indexOf("content ready", loading);
		const idle = beforeEnhancement.indexOf(
			'"_sessionTransitionStatus":"idle"',
			loading + 1,
		);
		if (!(loading >= 0 && fallback > loading && idle > fallback)) {
			throw new Error("Expected loading → fallback → idle ordering");
		}
		gate.resolve("<p>enhancement ready</p>");
		const enhanced = await readUntil(reader, (text) =>
			text.includes("enhancement ready"),
		);
		assertIncludes(enhanced, "data: selector [data-message-id=");
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

test("running background transcript stays headless until activation", async () => {
	let enhancementCount = 0;
	const background = new TranscriptState({ keys: "N", description: "New" });
	background.appendAssistantDelta("```ts\nconst partial = true");
	background.appendMessage("tool", "still running", {
		state: "running",
		format: "code",
	});
	background.setQueuedMessages(["steer"], ["follow"]);
	await settleMicrotasks();
	assertEqual(enhancementCount, 0);

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

test("completed background transcript enhances only after activation", async () => {
	let enhancementCount = 0;
	const background = new TranscriptState({ keys: "N", description: "New" });
	background.appendAssistantDelta("completed **answer**");
	background.finishAssistant();
	await settleMicrotasks();
	assertEqual(enhancementCount, 0);

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

test("nested state updates commit one fat morph and one signal patch", async () => {
	const state = createState();
	const controller = new AbortController();
	try {
		const reader = await openInitializedStateStream(state, controller.signal);
		state.update(
			() => {
				state.setActivityText("Working...");
				state.update(() => {
					state.setWorkspacePath("/tmp/workspace");
					state.setTemporarySession(true);
				});
				state.setThinking("high", ["off", "high"]);
			},
			{ flush: true },
		);
		const output = await readUntil(
			reader,
			(text) =>
				count(text, "event: datastar-patch-elements") === 1 &&
				count(text, "event: datastar-patch-signals") === 1,
		);

		assertEqual(count(output, "event: datastar-patch-elements"), 1);
		assertEqual(count(output, "event: datastar-patch-signals"), 1);
		assertIncludes(output, '"_temporarySession":true');
		assertNotIncludes(output, '"_isBusy"');
		assertNotIncludes(output, '"thinkingLevel"');
		assertNotIncludes(output, '"model"');
	} finally {
		controller.abort();
	}
});

test("a thrown update still commits its completed mutations", async () => {
	const state = createState();
	const controller = new AbortController();
	try {
		const reader = await openInitializedStateStream(state, controller.signal);
		try {
			state.update(() => {
				state.workspacePath = "/tmp/committed-before-throw";
				throw new Error("stop");
			});
		} catch {
			// The mutator error is expected; already-applied state remains authoritative.
		}
		await readElementAndSignalPatches(reader);
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

test("session pagination patches only session-owned regions", async () => {
	const state = createState();
	const sessions = Array.from({ length: 70 }, (_, index) => ({
		path: `/sessions/${index}.jsonl`,
		cwd: "/workspace",
		title: `Session ${index}`,
		messageCount: index,
		modified: "now",
	}));
	state.setSessionCatalog(sessions);
	state.setSessionCatalogLoading(false);
	state.loadMoreSessions();
	state.flush();
	assertEqual(state.snapshot().sessions.length, 60);
	assertEqual(state.snapshot().sessionsHasMore, true);

	const controller = new AbortController();
	try {
		const reader = await openInitializedStateStream(state, controller.signal);
		state.setUsage({ text: "$2.000 • 2 tokens", costText: "$2.000" });
		state.flush();
		const unrelated = await readUntil(reader, (text) => text.includes("$2.000"));
		assertNotIncludes(unrelated, 'id="session-sidebar-content"');

		state.updateSessionSummary(sessions[0].path, (session) => ({
			...session,
			title: "Updated active session",
		}));
		state.flush();
		const updated = await readUntil(reader, (text) =>
			text.includes("Updated active session"),
		);
		assertIncludes(updated, 'id="session-sidebar-content"');

		new SessionCatalog(state).touch(sessions[0].path);
		state.flush();
		const touched = await readUntil(reader, (text) =>
			text.includes('id="session-sidebar-content"'),
		);
		assertIncludes(touched, 'id="session-sidebar-content"');
		assertNotIncludes(touched, 'id="session-menu-content"');

		state.loadMoreSessions();
		state.flush();
		const complete = await readUntil(reader, (text) => text.includes("Session 69"));
		assertNotIncludes(complete, "@post('/sessions/more'");
		assertEqual(state.snapshot().sessionsHasMore, false);
	} finally {
		controller.abort();
	}
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

test("initial streams reopen active backend dialogs", async () => {
	const state = createState();
	state.setAuthDialog({
		mode: "login",
		phase: "providers",
		providers: [],
		progress: [],
	});
	state.flush();
	const output = await readStateOutput(
		state,
		(text) =>
			text.includes("auth-dialog") &&
			text.includes("if (dialog && !dialog.open) dialog.showModal()"),
	);
	assertIncludes(output, "if (dialog && !dialog.open) dialog.showModal()");
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

test("state snapshots reuse the extension/live-workspace references instead of deep-cloning on every read (A#12)", () => {
	const state = createState();
	state.setExtensionElements([piUiWidget("w1", { revision: 1 })]);
	state.setExtensionChannels([
		{ channel: "demo", payload: { ok: true }, updatedAt: 0 },
	]);
	state.setLiveWorkspace({ ...emptyLiveWorkspaceSnapshot, revision: 1 });

	const first = state.snapshot();
	const second = state.snapshot();
	assertEqual(first.extensionElements === second.extensionElements, true);
	assertEqual(first.extensionChannels === second.extensionChannels, true);
	assertEqual(first.liveWorkspace === second.liveWorkspace, true);
});

test("PIUI widgets and sheets patch only when extension elements change, not on every commit (A#11)", async () => {
	const state = createState();
	const controller = new AbortController();
	try {
		const reader = await openInitializedStateStream(state, controller.signal);

		state.update(() => state.setExtensionElements([piUiWidget("w1")]), {
			flush: true,
		});
		const withWidget = await readUntil(reader, (text) =>
			text.includes('data-piui-element="demo:w1"'),
		);
		assertEqual(count(withWidget, 'id="piui-widgets"'), 1);

		// A storm of unrelated commits (chat/usage updates, exactly what used to re-render
		// `renderAppElements` — and with it PIUI — on every single one) must not re-send the
		// PIUI region at all. (Each commit's main region patch alone is tens of KB, so this
		// stays small enough for the test transport's read budget.)
		for (let index = 0; index < 5; index += 1) {
			state.update(
				() => state.setUsage({ text: `${index} tokens`, costText: "$0.00" }),
				{ flush: true },
			);
		}
		const afterStorm = await readUntil(reader, (text) => text.includes("4 tokens"));
		assertEqual(count(afterStorm, 'id="piui-widgets"'), 0);

		// A genuine element change still patches it, exactly once.
		state.update(
			() => state.setExtensionElements([piUiWidget("w1", { revision: 2 })]),
			{ flush: true },
		);
		const afterUpdate = await readUntil(reader, (text) => text.includes("updated"));
		assertEqual(count(afterUpdate, 'id="piui-widgets"'), 1);
	} finally {
		controller.abort();
	}
});

test("a live workspace fleet storm patches only the agents tab, not usage/now/activity/extensions (A#13)", async () => {
	const state = createState();
	const controller = new AbortController();
	try {
		const reader = await openInitializedStateStream(state, controller.signal);
		state.update(() => state.setLiveWorkspacePreferences({ tab: "agents" }), {
			flush: true,
		});
		// A preference change dirties all five regions (patched in a fixed order ending
		// with "extensions" — see `patchDirtyRegions`); wait for the last one so none of
		// the setup's own patches leak into the storm assertions below.
		await readUntil(reader, (text) =>
			text.includes('id="live-workspace-extensions"'),
		);

		let revision = 1;
		// Each commit's main region patch alone is tens of KB, so this stays small enough
		// for the test transport's read budget.
		const storms = 5;
		for (let index = 0; index < storms; index += 1) {
			state.update(
				() =>
					state.setLiveWorkspace({
						...emptyLiveWorkspaceSnapshot,
						revision: revision++,
						agents: [
							{
								id: "scout",
								kind: "channel-entry",
								source: "subagents:fleet",
								label: `scout-${index}`,
								status: index % 2 === 0 ? "running" : "idle",
								depth: 0,
							},
						],
					}),
				{ flush: true },
			);
		}
		const output = await readUntil(reader, (text) =>
			text.includes(`scout-${storms - 1}`),
		);
		assertEqual(count(output, 'id="live-workspace-agents"'), storms);
		assertEqual(count(output, 'id="live-workspace-now"'), 0);
		assertEqual(count(output, 'id="live-workspace-activity"'), 0);
		assertEqual(count(output, 'id="live-workspace-usage"'), 0);
		assertEqual(count(output, 'id="live-workspace-extensions"'), 0);
		assertEqual(count(output, 'id="piui-widgets"'), 0);
		// Morph-bytes budget: each agents-tab patch carries only that tab's small fragment,
		// never a whole-pane re-render.
		const agentPatchBytes = output
			.split("event: ")
			.filter((event) => event.includes('id="live-workspace-agents"'))
			.map((event) => new TextEncoder().encode(event).byteLength);
		assertEqual(agentPatchBytes.length, storms);
		assertEqual(
			agentPatchBytes.every((bytes) => bytes < 4096),
			true,
			`agents patch sizes: ${agentPatchBytes.join(", ")}`,
		);
	} finally {
		controller.abort();
	}
});

test("a dismissed PIUI sheet is not reopened on the next connection while its open generation is unchanged (A#16)", async () => {
	const state = createState();
	state.setExtensionElements([
		{
			id: "panel",
			ns: "ask-user",
			kind: "panel",
			placement: "sheet",
			data: {},
			revision: 3,
			openGeneration: 3,
			updatedAt: 0,
		},
	]);
	// The dismiss handler and the reopen-guard script both reference the same storage key,
	// so wait for the guard's own distinguishing text (not just the shared key substring,
	// which the dismiss handler's `data-on:close` attribute emits earlier in the stream).
	const output = await readStateOutput(state, (text) =>
		text.includes("dismissedGeneration"),
	);
	assertIncludes(
		output,
		'localStorage.getItem("piui-dismissed-piui-sheet-ask-user-panel")',
	);
	assertIncludes(output, 'dismissedGeneration !== "3"');
	assertIncludes(output, "document.getElementById('piui-sheet-ask-user-panel')");
});

test("re-set()-ing an existing, dismissed sheet id gets a fresh open effect (M4a/M4b)", async () => {
	const state = createState();
	const baseSheet = {
		id: "panel",
		ns: "ask-user",
		kind: "panel" as const,
		placement: "sheet" as const,
		data: {},
		updatedAt: 0,
	};
	// The exact open-effect script `pickerEffectScripts` emits for this dialog id (see
	// `ui-renderer.ts`'s "dialog" effect branch) — counted below rather than just checked for
	// presence, so a stray leftover from an earlier update in the same accumulated read can't
	// pass the assertion by coincidence.
	const openScript =
		"document.getElementById('piui-sheet-ask-user-panel'); let dismissedGeneration;";
	const controller = new AbortController();
	try {
		// Start from an empty connection so the whole sequence below is observed as
		// incremental patches, not folded into the initial page render. Accumulate every read
		// into one running buffer: dirtying `extensionElements` also dirties `pickers` (the
		// open-effect script's own region), and those two patches can land in either order
		// within — or split across — the transport's read chunks, so per-read isolation is
		// unreliable; a cumulative count at each checkpoint is not.
		const reader = await openInitializedStateStream(state, controller.signal);
		let acc = "";
		// Reads until both `marker` (this update's own distinguishing content) and at least
		// `expectedOpenScripts` occurrences of the open-effect script have arrived — the two
		// patches (extension elements, pickers) can land in either read chunk, so waiting on
		// `marker` alone can race ahead of an open-effect script still in flight.
		const readMore = async (marker: string, expectedOpenScripts: number) => {
			acc += await readUntil(
				reader,
				(text) =>
					(acc + text).includes(marker) &&
					count(acc + text, openScript) >= expectedOpenScripts,
			);
			return acc;
		};

		// A genuinely new sheet id gets an open effect.
		state.update(
			() =>
				state.setExtensionElements([
					{
						...baseSheet,
						revision: 1,
						openGeneration: 1,
						data: { sections: [{ kind: "status", text: "hello" }] },
					},
				]),
			{ flush: true },
		);
		await readMore("hello", 1);
		assertEqual(count(acc, openScript), 1);

		// Simulate the user dismissing it: the store itself doesn't track dismissal (that's
		// client-side `localStorage`), so only the element list changes here. A `patch`-style
		// content update (same `openGeneration`) must NOT get another open effect. There's
		// nothing further to wait for here, so read once and assert the count held steady.
		state.update(
			() =>
				state.setExtensionElements([
					{
						...baseSheet,
						revision: 2,
						openGeneration: 1,
						data: { sections: [{ kind: "status", text: "streaming" }] },
					},
				]),
			{ flush: true },
		);
		await readMore("streaming", 1);
		assertEqual(count(acc, openScript), 1);

		// A deliberate re-`set` (a fresh `openGeneration`) DOES get a new open effect, even
		// though the id was already known.
		state.update(
			() =>
				state.setExtensionElements([
					{
						...baseSheet,
						revision: 3,
						openGeneration: 2,
						data: { sections: [{ kind: "status", text: "again" }] },
					},
				]),
			{ flush: true },
		);
		await readMore("again", 2);
		assertEqual(count(acc, openScript), 2);
		assertIncludes(acc, 'dismissedGeneration !== "2"');

		// `/new`, `/reload` and session switches unbind (clearing the list) and then restore
		// the same elements: the resulting open effect must stay dismissal-aware, so a sheet
		// the user already closed at this generation doesn't pop back over the prompt.
		state.update(() => state.setExtensionElements([]), { flush: true });
		state.update(
			() =>
				state.setExtensionElements([
					{
						...baseSheet,
						revision: 3,
						openGeneration: 2,
						data: { sections: [{ kind: "status", text: "restored" }] },
					},
				]),
			{ flush: true },
		);
		await readMore("restored", 3);
		assertEqual(count(acc, openScript), 3);
		assertEqual(
			count(
				acc,
				"document.getElementById('piui-sheet-ask-user-panel'); if (dialog && !dialog.open) dialog.showModal();",
			),
			0,
		);
	} finally {
		controller.abort();
	}
});

test("hot app views exclude independently owned regions", () => {
	const previous = process.env.PI_UI_DEBUG;
	process.env.PI_UI_DEBUG = "1";
	try {
		const store = new AppStore();
		const renderer = new UiRenderer(store, new DatastarClientHub());
		const snapshot = store.snapshot();
		const view = renderer.renderElements(renderer.projectState(snapshot));
		assertIncludes(view, 'id="debug-fps" data-ignore-morph');
		for (const id of [
			"messages",
			"prompt-action",
			"prompt-queue",
			"toolbar",
			"prompt-status",
			"workspace-picker",
			"session-transition",
			"debug-overlay",
		])
			assertIncludes(view, `id="${id}"`);
		for (const id of [
			"auth-dialog-content",
			"extension-dialog-content",
			"llama-dialog-content",
			"workspace-menu",
			"model-picker",
			"thinking-picker",
			"slash-picker",
			"tree-picker",
			"session-menu-content",
			"session-sidebar-content",
			"workspace-review-data",
		])
			assertNotIncludes(view, `id="${id}"`);
	} finally {
		if (previous === undefined) delete process.env.PI_UI_DEBUG;
		else process.env.PI_UI_DEBUG = previous;
	}
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

function piUiWidget(id: string, overrides: Partial<PiUiElement> = {}): PiUiElement {
	const revision = overrides.revision ?? 1;
	return {
		id,
		ns: "demo",
		kind: "widget",
		placement: "pinned",
		data: { lines: [revision === 1 ? "hello" : "updated"] },
		revision,
		openGeneration: overrides.openGeneration ?? revision,
		updatedAt: 0,
		...overrides,
	};
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

async function collectFinalizedPatches(state: TestStore, response: Response) {
	await waitFor(() => projectedMessages(state)[0].presentationState === "final");
	state.setUsage({ text: "$1.000 • 1 token", costText: "$1.000" });
	return collectElementPatches(response, 4);
}

function count(value: string, search: string): number {
	return value.split(search).length - 1;
}
