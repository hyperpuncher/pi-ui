import { onTestFinished, spyOn, test } from "bun:test";

import { attributesToString } from "@kitajs/html";

import { toolTitleParts } from "#src/agent/tool-presentation.ts";
import { DatastarClientHub } from "#src/server/datastar-client-hub.ts";
import { AppStore } from "#src/state/app-store.ts";
import {
	type TranscriptMessageInput,
	TranscriptState,
} from "#src/state/transcript-state.ts";
import { projectBackendSignals } from "#src/ui/backend-signals.ts";
import { loadPierreLanguage } from "#src/ui/diffs.ts";
import { renderMarkdownFinal } from "#src/ui/markdown.tsx";
import type { MessageRenderServiceOptions } from "#src/ui/message-render-service.ts";
import { renderPage } from "#src/ui/page.tsx";
import { UiRenderer } from "#src/ui/ui-renderer.ts";
import {
	assertEquals as assertEqual,
	assertStringExcludes as assertNotIncludes,
	assertStringIncludes as assertIncludes,
} from "#testing/assertions";
import { readUntil, responseReader } from "#testing/streams.ts";

const timestamp = new Date("2026-01-01T00:00:00.000Z");
const configuredModel = {
	id: "fixture-model",
	provider: "fixture",
	name: "Fixture model",
	configured: true,
	scoped: true,
};

test("restored messages are readable before final highlighting finishes", async () => {
	const gates: Array<(html: string) => void> = [];
	const render = () => new Promise<string>((resolve) => gates.push(resolve));
	const state = createState({ renderMarkdownFinal: render, renderCode: render });
	const controller = connection();
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
	await waitFor(() => gates.length === 2);
	gates.forEach((resolve, index) =>
		resolve(`<div data-enhanced="${index}">safe</div>`),
	);
	await readUntil(
		reader,
		(text) =>
			text.includes('data-enhanced="0"') && text.includes('data-enhanced="1"'),
	);
});

test("cached Markdown restores do not send identical enhancement patches", async () => {
	const text = "```ts\nconst cachedEnhancement = true;\n```";
	await renderMarkdownFinal(text);
	const state = createState();
	const reader = await openInitializedStateStream(state, connection().signal);
	state.replaceMessages([markdownMessage(text)]);
	const transcript = await readUntil(reader, (output) =>
		output.includes("data: selector #messages"),
	);
	assertIncludes(transcript, "cachedEnhancement");
	await waitFor(() => projectedMessages(state)[0].presentationState === "final");
	state.setActivityText("after cached enhancement");
	const tail = await readUntil(reader, (output) =>
		output.includes("after cached enhancement"),
	);
	assertNotIncludes(transcript + tail, "data: selector #message-");
});

test.each([
	markdownMessage("lightweight source"),
	{ role: "tool", text: "@@ -1 +1 @@\n-old\n+new", timestamp, format: "diff" },
] satisfies TranscriptMessageInput[])(
	"ordinary commits exclude finalized $role messages",
	async (message) => {
		const render = async () => "<p>finalized content</p>";
		const state = createState({ renderMarkdownFinal: render, renderDiff: render });
		const response = state.createStream(connection().signal);
		state.replaceMessages([message]);
		const { finalized, ordinary } = await collectFinalizedPatches(
			state,
			response,
			"finalized content",
		);
		assertIncludes(finalized, "finalized content");
		assertNotIncludes(ordinary, "finalized content");
		assertNotIncludes(ordinary, message.text);
		assertNotIncludes(ordinary, 'id="messages"');
	},
);

test("ordinary commits skip stable views until their state changes", async () => {
	const state = stateWithMessages(1);
	const controller = connection();
	const reader = await openInitializedStateStream(state, controller.signal);
	state.setActivityText("Working...");
	const ordinary = await readUntil(reader, (text) => text.includes("Working..."));
	assertIncludes(ordinary, 'class="prompt-status-message"');
	assertNotIncludes(ordinary, 'id="messages"');
	assertNotIncludes(ordinary, 'id="model-picker"');
	assertNotIncludes(ordinary, 'id="session-sidebar-content"');
	assertNotIncludes(ordinary, 'id="workspace-review-data"');

	state.setModels([configuredModel], "fixture/fixture-model");
	const full = await readUntil(
		reader,
		(text) =>
			text.includes("fixture-model") && text.includes("workspace-review-data"),
	);
	assertNotIncludes(full, 'id="messages"');
	assertIncludes(full, 'id="model-picker"');
	assertIncludes(full, 'id="session-sidebar-content"');
	assertIncludes(full, 'id="workspace-review-data"');
});

test("asynchronous state changes send one latest view instead of intermediate transcripts", async () => {
	const state = stateWithMessages(1);
	state.setSessionCatalog([
		{
			path: "/sessions/batch.jsonl",
			cwd: "/workspace",
			title: "Batch fixture",
			messageCount: 1,
			modified: "now",
		},
	]);
	const reader = await openInitializedStateStream(state, connection().signal);
	for (let index = 0; index < 4; index += 1) {
		state.appendMessage("tool", `batch output ${index}`, { format: "pre" });
		state.updateSessionSummary("/sessions/batch.jsonl", (session) => ({
			...session,
			messageCount: index + 2,
		}));
		state.setUsage({ text: `batch usage ${index}`, costText: "$0.000" });
		state.setPromptEditorText(`batch draft ${index}`);
		await Promise.resolve();
	}
	const output = await readUntil(
		reader,
		(text) =>
			text.includes("batch usage 3") && text.includes('"prompt":"batch draft 3"'),
	);
	assertEqual(count(output, "data: selector #messages\n"), 1);
	const transcript = output
		.split("\n\n")
		.find((event) => event.includes("data: selector #messages\n"))!;
	for (let index = 0; index < 4; index += 1)
		assertIncludes(transcript, `batch output ${index}`);
	assertNotIncludes(output, "batch usage 0");
});

test("empty chat refreshes login, catalog loading, and recent sessions", async () => {
	const state = createState();
	const reader = responseReader(state.createStream(connection().signal));
	const initial = await readUntil(reader, (text) =>
		text.includes("event: datastar-patch-signals"),
	);
	assertIncludes(initial, "messages-empty-login");

	state.setActivityText("Working...");
	const ordinary = await readUntil(
		reader,
		(text) =>
			text.includes("Working...") && text.includes("event: datastar-patch-signals"),
	);
	assertNotIncludes(ordinary, 'id="messages"');
	state.setModels([configuredModel], "fixture/fixture-model");
	const authenticated = await readUntil(reader, (text) =>
		text.includes("event: datastar-patch-signals"),
	);
	assertIncludes(authenticated, "data: selector #messages");
	assertNotIncludes(authenticated, "messages-empty-login");
	assertIncludes(authenticated, "recent-sessions-loading");

	state.setSessionCatalog([
		{
			path: "/sessions/recent.jsonl",
			cwd: "/workspace",
			title: "Recent fixture",
			messageCount: 1,
			modified: "now",
		},
	]);
	state.setSessionCatalogLoading(false);
	const loaded = await readUntil(reader, (text) =>
		text.includes("event: datastar-patch-signals"),
	);
	const transcript =
		loaded
			.split("\n\n")
			.find((event) => event.includes("data: selector #messages\n")) ?? "";
	assertIncludes(transcript, "Recent fixture");
	assertNotIncludes(transcript, "recent-sessions-loading");
});

test("new messages morph the complete transcript", async () => {
	const state = createState();
	const controller = connection();
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
	assertIncludes(tools, "data: selector #messages");
	assertNotIncludes(tools, "data: mode replace");
	assertIncludes(tools, '<main id="messages"');
});

test("tool display changes rerender only the active presentation", async () => {
	const state = createState();
	state.replaceMessages([
		{
			role: "tool",
			title: "codemode",
			timestamp,
			titleParts: toolTitleParts("codemode", {
				code: 'text("preview");\ntext("later_line");',
			}),
			text: "full_output",
			format: "output",
			state: "success",
		},
	]);
	const controller = connection();
	const reader = responseReader(state.createStream(controller.signal));
	const expanded = await readUntil(reader, (text) =>
		text.includes("event: datastar-patch-signals"),
	);
	assertIncludes(expanded, "tool-header");
	assertNotIncludes(expanded, "tool-title-compact");

	state.update(() => {
		state.toolOutputHidden = true;
	});
	const compactOutput = await readUntil(
		reader,
		(text) =>
			text.includes("data: selector #messages") &&
			text.includes("tool-title-compact"),
	);
	const compact = compactOutput.slice(
		compactOutput.indexOf("data: selector #messages"),
	);
	assertIncludes(compact, "data: selector #messages");
	assertNotIncludes(compact, "full_output");
	assertNotIncludes(compact, "later_line");
	assertNotIncludes(compact, "tool-header");

	const id = state.messages[0]!.id;
	state.updateMessage(id, { text: "updated_output", meta: "9ms" });
	const update = await readUntil(reader, (text) => text.includes("9ms"));
	assertIncludes(update, "tool-title-compact");
	assertNotIncludes(update, "updated_output");
	assertNotIncludes(update, "tool-header");

	state.appendMessage("tool", "appended_output", {
		title: "append_preview",
		format: "output",
	});
	const appended = await readUntil(reader, (text) => text.includes("append_preview"));
	assertIncludes(appended, "tool-title-compact");
	assertNotIncludes(appended, "appended_output");
	assertNotIncludes(appended, "tool-header");

	const older = state.renderer.messages.renderTranscript(state.snapshot());
	assertIncludes(older, "tool-title-compact");
	assertNotIncludes(older, "updated_output");
	assertNotIncludes(older, "tool-header");

	const reconnected = await readStateOutput(state, (text) =>
		text.includes("event: datastar-patch-signals"),
	);
	assertIncludes(reconnected, "tool-title-compact");
	assertNotIncludes(reconnected, "updated_output");
	assertNotIncludes(reconnected, "tool-header");

	state.update(() => {
		state.minimalMode = true;
		state.toolOutputHidden = false;
	});
	await readUntil(reader, (text) => text.includes('"_minimalMode":true'));
	assertIncludes(
		state.renderer.messages.renderMessageElement(id)!,
		"tool-title-compact",
	);

	state.update(() => {
		state.minimalMode = false;
	});
	const restored = await readUntil(reader, (text) => text.includes("updated_output"));
	assertIncludes(restored, "tool-header");
	assertIncludes(restored, "later_line");
	assertNotIncludes(restored, "tool-title-compact");
});

test("fast tool highlighting never arrives before its transcript row", async () => {
	await loadPierreLanguage("bash");
	const state = createState({
		renderCode: async () => "<pre>final tool rendering</pre>",
	});
	const reader = await openInitializedStateStream(state, connection().signal);
	state.appendMessage("tool", "tool source", { format: "code", state: "success" });
	const output = await readUntil(
		reader,
		(text) =>
			text.includes("data: selector #messages\n") &&
			text.includes("final tool rendering"),
	);
	assertEqual(
		output.indexOf("data: selector #messages\n") <
			output.indexOf("final tool rendering"),
		true,
	);
});

test("parallel message updates all reach their final state", async () => {
	const state = createState();
	const controller = connection();
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
	await readUntil(reader, (text) => text.includes(firstId) && text.includes(secondId));

	state.updateMessage(firstId, { title: "read first.ts", state: "success" });
	state.updateMessage(secondId, { title: "read second.ts", state: "success" });
	const updates = await readUntil(
		reader,
		(text) => text.includes("read first.ts") && text.includes("read second.ts"),
	);

	assertEqual(count(updates, "data: selector #message-"), 2);
	assertEqual(count(updates, "tool-status-success"), 2);
});

test("session transitions preserve targeted transcript replacement and ordinary presentation", async () => {
	const state = createState();
	const controller = connection();
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
	const restored = await readUntil(
		reader,
		(text) =>
			text.includes("restored transcript") &&
			text.includes('id="prompt-action"') &&
			text.includes("datastar-patch-signals"),
	);
	assertIncludes(restored, 'id="messages"');
	assertIncludes(restored, "data: selector #messages");
	assertNotIncludes(restored, "data: mode replace");

	state.setSessionTransition({ status: "idle", generation: 1 });
	await readUntil(reader, (text) => text.includes('"_sessionTransitionStatus":"idle"'));
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
	const older = state.loadOlderMessages();
	assertEqual(older.length, 30);
	state.renderer.patchOlderMessages(older);

	const immediatePage = state.renderer.messages.renderTranscript(state.snapshot());
	assertIncludes(immediatePage, "<strong>message 0</strong>");
	assertNotIncludes(immediatePage, "**message 0**");
	await waitFor(() => renderCount === 60);
	assertEqual(state.loadOlderMessages(), []);
	await waitFor(() =>
		projectedMessages(state).every(
			({ presentationState }) => presentationState === "final",
		),
	);
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
	await waitFor(() =>
		projectedMessages(state).every(
			({ presentationState }) => presentationState === "final",
		),
	);
	state.showRecentMessages();
	assertEqual(state.messages.length, 30);

	theme = "after";
	rendered.length = 0;
	state.renderer.codeThemeChanged();
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

test("older history patches only the loaded page and the trigger", async () => {
	const state = stateWithMessages(130);
	const controller = connection();
	const reader = await openInitializedStateStream(state, controller.signal);
	const older = state.loadOlderMessages();
	assertEqual(older.length, 30);
	state.renderer.patchOlderMessages(older);
	const output = await readUntil(reader, (text) => text.includes("afterOlder()"));
	assertEqual(output.indexOf("beforeOlder()") >= 0, true);
	assertEqual(output.indexOf("beforeOlder()") < output.indexOf("message 70"), true);
	assertEqual(output.indexOf("message 70") < output.indexOf("afterOlder()"), true);
	assertIncludes(output, "data: selector #older-messages-trigger");
	assertIncludes(output, "data: mode after");
	assertIncludes(output, "message 70");
	assertNotIncludes(output, "message 69");
	assertNotIncludes(output, "data: selector #messages");

	while (state.hasOlderMessages) {
		state.renderer.patchOlderMessages(state.loadOlderMessages());
	}
	const complete = await readUntil(reader, (text) =>
		text.includes('data: elements <div id="older-messages-trigger"'),
	);
	assertIncludes(complete, "message 0");
	assertNotIncludes(complete, 'data-active="1"');

	state.trimOldMessages(state.messages[0].id, state.messages[29].id);
	const trimmed = await readUntil(reader, (text) => text.includes('data-active="1"'));
	assertIncludes(trimmed, "data: mode remove");
	assertNotIncludes(trimmed, "data: selector #messages");
});

test("trimmed messages release their rendered presentations", async () => {
	let renderCount = 0;
	const state = createState({
		renderMarkdownFinal: async (text) => {
			renderCount += 1;
			return `<p>${text}</p>`;
		},
	});
	connect(state);
	const firstId = state.appendMessage("assistant", "old answer");
	state.finishAssistant();
	for (let index = 0; index < 100; index += 1) state.appendMessage("user", "new");
	await waitFor(() => projectedMessages(state)[0].presentationState === "final");
	assertEqual(renderCount, 1);
	state.trimOldMessages(firstId, firstId);
	state.renderer.patchOlderMessages(state.loadOlderMessages());
	await waitFor(() => renderCount === 2);
});

test("repaging morphs the transcript and moves to the recent page", async () => {
	const state = createState();
	state.replaceMessages(
		Array.from({ length: 80 }, (_, index) => ({
			role: "user" as const,
			text: `message ${index}`,
			timestamp,
		})),
	);
	state.loadOlderMessages();
	const controller = connection();
	const reader = await openInitializedStateStream(state, controller.signal);

	state.showRecentMessages();
	const output = await readUntil(reader, (text) =>
		text.includes("window.piUi.messageScroll.scrollBottom()"),
	);

	assertIncludes(output, 'id="messages"');
	assertIncludes(output, 'data-active="1"');
	assertIncludes(output, "message 50");
});

test("replacement discards stale enhancement completion", async () => {
	const { state, gates } = gatedEnhancementQueue();
	connect(state);
	state.replaceMessages([markdownMessage("session A")]);
	await waitFor(() => gates.length >= 1);
	state.replaceMessages([markdownMessage("session B")]);
	gates[0].resolve("<p>stale A</p>");
	await waitFor(() => gates.length >= 2);
	gates[1].resolve("<p>final B</p>");
	await waitFor(() =>
		projectedMessages(state).every(
			({ presentationState }) => presentationState === "final",
		),
	);

	assertEqual(state.messages.length, 1);
	assertEqual(state.messages[0].text, "session B");
	assertEqual(projectedMessages(state)[0].renderedHtml, "<p>final B</p>");
	assertEqual(projectedMessages(state)[0].presentationState, "final");
});

test("cancelled enhancement cannot change an identical restored message", async () => {
	const { state, gates } = gatedEnhancementQueue();
	connect(state);
	state.replaceMessages([markdownMessage("same content")]);
	await waitFor(() => gates.length === 1);
	state.restoreChat(state.snapshotChat());
	gates[0].resolve("<p>stale output</p>");
	await waitFor(() => gates.length === 2);
	assertNotIncludes(projectedMessages(state)[0].renderedHtml ?? "", "stale output");

	gates[1].resolve("<p>current output</p>");
	await waitFor(
		() => projectedMessages(state)[0].renderedHtml === "<p>current output</p>",
	);
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
		const interim = state.renderer.messages.renderTranscript(state.snapshot());
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
		await waitFor(() => projectedMessages(state)[0].presentationState === "final");
		assertIncludes(
			state.renderer.messages.renderTranscript(state.snapshot()),
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
	await Bun.sleep(0);

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

test("background activation resumes streaming and enhances completed messages", async () => {
	let enhancementCount = 0;
	const background = new TranscriptState({ keys: "N", description: "New" });
	background.appendAssistantDelta("```ts\nconst partial = true");
	background.appendMessage("tool", "still running", {
		state: "running",
		format: "code",
	});
	background.setActivityText("Working...");
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
	await waitFor(() => enhancementCount === 1);

	assertEqual(projectedMessages(foreground)[0].presentationState, "streaming");
	assertIncludes(projectedMessages(foreground)[0].renderedHtml ?? "", "partial");
	assertEqual(foreground.messages[1].state, "running");
	assertEqual(foreground.activityText, "Working...");
	assertEqual(foreground.queuedSteeringMessages, ["steer"]);
	assertEqual(foreground.queuedFollowUpMessages, ["follow"]);

	background.finishAssistant();
	foreground.restoreChat(background.snapshot());
	await waitFor(() => projectedMessages(foreground)[0].presentationState === "final");
	assertIncludes(projectedMessages(foreground)[0].renderedHtml ?? "", "partial");
});

test("enhancement errors retain the rendered Markdown fallback", async () => {
	const warn = spyOn(console, "warn").mockImplementation(() => {});
	onTestFinished(() => warn.mockRestore());
	const state = createState({
		renderMarkdownFinal: () => Promise.reject(new Error("render failed")),
	});
	connect(state);
	state.replaceMessages([markdownMessage("**fallback**")]);
	await waitFor(() => warn.mock.calls.length > 0);
	assertEqual(projectedMessages(state)[0].presentationState, "plain");
	assertIncludes(
		state.renderer.messages.renderTranscript(state.snapshot()),
		"<p><strong>fallback</strong></p>",
	);
});

test("a thrown update still commits its completed mutations", async () => {
	const state = createState();
	const controller = connection();
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
	await Bun.sleep(0);
	assertEqual(rendered, []);
	assertEqual(
		state.messages.map(({ text }) => text),
		["offline answer", "finished tool"],
	);

	const first = connection();
	const firstReader = responseReader(state.createStream(first.signal));
	const initial = await readElementAndSignalPatches(firstReader);
	assertIncludes(initial, "offline answer");
	await waitFor(() => rendered.length === 2);
	await Bun.sleep(0);
	const second = connect(state);
	first.abort();
	state.appendAssistantDelta("one tab remains");
	state.finishAssistant();
	state.renderer.requestCommit();
	await waitFor(() => rendered.includes("one tab remains"));
	assertEqual(rendered.length, 3);

	second.abort();
	state.appendAssistantDelta("offline again");
	state.finishAssistant();
	await Bun.sleep(0);
	assertEqual(rendered.length, 3);

	state.setActivityText("disconnected");
	const reconnect = responseReader(state.createStream(connection().signal));
	const restored = await readElementAndSignalPatches(reconnect);
	assertIncludes(restored, "offline again");
	assertIncludes(restored, "disconnected");
	await waitFor(() => projectedMessages(state).at(-1)?.presentationState === "final");
	assertEqual(rendered.filter((text) => text === "offline again").length, 1);
});

test("reconnecting during a turn resumes streaming and final highlighting", async () => {
	const state = createState();
	state.appendAssistantDelta("before **connection** ");
	connect(state);
	assertEqual(projectedMessages(state)[0].presentationState, "streaming");
	state.appendAssistantDelta("and after");
	state.finishAssistant();
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
	assertNotIncludes(
		state.renderer.messages.renderTranscript(state.snapshot()),
		"stale rendering",
	);
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
	const controller = connection();
	const reader = await openInitializedStateStream(state, controller.signal);
	state.setDocumentTitle("</title><script>globalThis.titleInjected = true</script>");
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
});

test("app stream refreshes current and background session statuses", async () => {
	const state = createState();
	const controller = connection();
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
	const response = state.renderer.createStream(controller.signal);
	const reader = responseReader(response);
	await readUntil(reader, (text) => text.includes("event: datastar-patch-signals"));

	state.update(() => {
		state.setCurrentSessionPath(first.path);
		state.setActivityText("Working...");
		state.setSessionCatalog([first, second]);
	});
	const running = await readUntil(reader, (text) =>
		text.includes("event: datastar-patch-signals"),
	);
	assertIncludes(running, 'id="session-menu-content"');
	assertIncludes(running, 'aria-selected="true"');
	assertIncludes(running, "First session");
	assertIncludes(running, 'aria-label="Current session running"');
	assertIncludes(running, "data: useViewTransition true");
	assertIncludes(running, "data: viewTransitionSelector #session-sidebar-viewport");

	state.updateSessionSummary(first.path, (session) => ({
		...session,
		title: "Renamed session",
	}));
	const renamed = await readUntil(reader, (text) =>
		text.includes("event: datastar-patch-signals"),
	);
	assertIncludes(renamed, "Renamed session");
	assertNotIncludes(renamed, "data: useViewTransition true");

	state.update(() => {
		state.setCurrentSessionPath(second.path);
		state.setActivityText(undefined);
		state.setSessionCatalog([{ ...first, backgroundStatus: "completed" }, second]);
	});
	const completed = await readUntil(reader, (text) =>
		text.includes("event: datastar-patch-signals"),
	);
	assertIncludes(completed, 'aria-label="Background session completed"');
	assertIncludes(completed, 'id="session-menu-content"');
	assertIncludes(completed, 'aria-selected="true"');
	assertNotIncludes(
		completed.slice(completed.lastIndexOf('id="session-menu-content"')),
		'aria-label="Current session running"',
	);
});

test("slash search is shared across connections and survives reconnect", async () => {
	const state = createState();
	state.setModels(
		["deepseek-v4", "claude-sonnet"].map((id) => ({
			id,
			provider: "fixture",
			name: id,
			configured: true,
			scoped: false,
		})),
		"fixture/deepseek-v4",
	);
	state.setSlashCommands([
		{ name: "login", description: "Log in", source: "system" },
		{ name: "skill:review", description: "Review code", source: "skill" },
	]);
	const first = connection();
	const second = connection();
	const reconnect = connection();
	const firstReader = responseReader(state.renderer.createStream(first.signal));
	const secondReader = responseReader(state.renderer.createStream(second.signal));
	await readUntil(firstReader, (text) =>
		text.includes("event: datastar-patch-signals"),
	);
	await readUntil(secondReader, (text) =>
		text.includes("event: datastar-patch-signals"),
	);
	state.renderer.setSlashSearch("review");
	const firstFiltered = await readUntil(firstReader, (text) =>
		text.includes("workspace-review-data"),
	);
	const secondFiltered = await readUntil(secondReader, (text) =>
		text.includes("workspace-review-data"),
	);
	for (const filtered of [firstFiltered, secondFiltered]) {
		assertIncludes(filtered, 'id="model-select-options"');
		assertNotIncludes(filtered, 'id="model-option-fixture%2Fdeepseek-v4"');
		assertIncludes(filtered, 'id="slash-option-skill%3Areview"');
		assertNotIncludes(filtered, 'id="slash-option-login"');
	}

	state.setThinking("high", ["off", "high"]);
	const update = await readUntil(firstReader, (text) =>
		text.includes("workspace-review-data"),
	);
	assertNotIncludes(update, 'id="slash-option-login"');
	first.abort();
	const restored = await readUntil(
		responseReader(state.renderer.createStream(reconnect.signal, "", "", "review")),
		(text) => text.includes("event: datastar-patch-signals"),
	);
	assertIncludes(restored, 'id="model-select-options"');
	assertNotIncludes(restored, 'id="model-option-fixture%2Fdeepseek-v4"');
	assertIncludes(restored, 'id="slash-option-skill%3Areview"');
	assertNotIncludes(restored, 'id="slash-option-login"');
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

function gatedEnhancementQueue() {
	const gates: Array<{ text: string; resolve: (html: string) => void }> = [];
	const state = createState({
		enhancementConcurrency: 1,
		renderMarkdownFinal: (text) =>
			new Promise<string>((resolve) => gates.push({ text, resolve })),
	});
	return { state, gates };
}

function connection(): AbortController {
	const controller = new AbortController();
	onTestFinished(() => controller.abort());
	return controller;
}

function connect(state: TestStore): AbortController {
	const controller = connection();
	state.createStream(controller.signal);
	return controller;
}

function projectedMessages(state: TestStore) {
	return state.renderer.projectState(state.snapshot()).messages;
}

function markdownMessage(text: string): TranscriptMessageInput {
	return { role: "assistant", text, timestamp };
}

async function waitFor(complete: () => boolean): Promise<void> {
	const deadline = Date.now() + 2_000;
	while (!complete()) {
		if (Date.now() >= deadline)
			throw new Error("Expected asynchronous work did not complete");
		// Let pending imports and timers run, not only promise callbacks.
		await Bun.sleep(0);
	}
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
	return readUntil(responseReader(state.createStream(connection().signal)), complete);
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
