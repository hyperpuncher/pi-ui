import { test } from "bun:test";

import { toolTitleParts } from "#src/agent/tool-presentation.ts";
import { AppStore } from "#src/state/app-store.ts";
import { loadHighlighter } from "#src/ui/diffs.ts";
import { MessageRenderService } from "#src/ui/message-render-service.ts";
import { renderMessage, renderMessages } from "#src/ui/messages.tsx";
import type { AppMessage } from "#src/ui/render-state.ts";
import {
	assertEquals,
	assertStringExcludes,
	assertStringIncludes,
} from "#testing/assertions";

function tool(overrides: Partial<AppMessage> = {}): AppMessage {
	return {
		id: "tool-1",
		role: "tool",
		state: "success",
		text: "",
		timestamp: new Date(0),
		title: "Read file",
		...overrides,
	};
}

test("user messages render attached images without placeholder text", () => {
	const html = renderMessage({
		id: "user-image",
		role: "user",
		text: "check this",
		attachments: [
			{
				name: "image.png",
				image: { data: "aW1hZ2U=", mimeType: "image/png" },
			},
			{ name: "notes.txt", mimeType: "text/plain", path: "/tmp/notes.txt" },
		],
		timestamp: new Date(0),
	});
	assertStringIncludes(html, 'src="data:image/png;base64,aW1hZ2U="');
	assertStringIncludes(
		renderMessage({
			id: "user-image-url",
			role: "user",
			text: "",
			attachments: [
				{
					name: "image.png",
					image: { url: "/sessions/image?id=one", mimeType: "image/png" },
				},
			],
			timestamp: new Date(0),
		}),
		'src="/sessions/image?id=one&thumb=1"',
	);
	const sized = renderMessage({
		id: "user-image-sized",
		role: "user",
		text: "",
		attachments: [
			{
				name: "image.png",
				image: {
					url: "/sessions/image?id=two",
					mimeType: "image/png",
					width: 1600,
					height: 1200,
				},
			},
		],
		timestamp: new Date(0),
	});
	// Thumbnail box is reserved from dimensions: no layout shift on load.
	assertStringIncludes(sized, 'width="384"');
	assertStringIncludes(sized, 'height="288"');
	assertStringIncludes(sized, 'href="/sessions/image?id=two"');
	assertStringIncludes(html, "notes.txt");
	assertStringIncludes(html, "check this");
	assertStringIncludes(html, 'loading="lazy"');
	assertStringIncludes(html, 'decoding="async"');
	assertStringExcludes(html, "[image:");
});

test("tool messages render generated images only in expanded mode", () => {
	const message = tool({
		text: "created",
		attachments: [
			{
				name: "Tool image 1",
				image: { data: "aW1hZ2U=", mimeType: "image/png" },
			},
		],
	});
	const expanded = renderMessage(message);
	assertStringIncludes(expanded, 'src="data:image/png;base64,aW1hZ2U="');
	assertStringIncludes(expanded, 'alt="Tool image 1"');
	assertStringExcludes(renderMessage(message, true), "aW1hZ2U=");
});

test("message projection replaces inline image data with stable URLs", () => {
	const store = new AppStore();
	let registrations = 0;
	const renderer = new MessageRenderService(store, () => {}, {
		registerImage: () => {
			registrations += 1;
			return "/sessions/image?id=one";
		},
	});
	// 1x1 png; projection probes the header to reserve the box.
	const data =
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
	store.transcript.replaceMessages([
		{
			role: "user",
			text: "",
			attachments: [{ name: "image.png", image: { data, mimeType: "image/png" } }],
			timestamp: new Date(0),
		},
	]);
	const message = renderer.projectMessages(store.transcript.messages)[0];
	assertEquals(message.attachments?.[0].image, {
		url: "/sessions/image?id=one",
		mimeType: "image/png",
		width: 1,
		height: 1,
	});
	renderer.projectMessages(store.transcript.messages);
	assertEquals(registrations, 1);
});

test("assistant messages summarize preceding tool activity", () => {
	const store = new AppStore();
	const renderer = new MessageRenderService(store, () => {});
	store.transcript.replaceMessages([
		{ role: "user", text: "fix it", timestamp: new Date(0) },
		{ role: "thought", text: "planning", timestamp: new Date(1_000) },
		{ role: "tool", text: "", timestamp: new Date(2_000), title: "read" },
		{ role: "thought", text: "editing", timestamp: new Date(3_000) },
		{ role: "tool", text: "", timestamp: new Date(4_000), title: "edit" },
		{ role: "assistant", text: "done", timestamp: new Date(65_000) },
	]);
	const assistant = renderer.projectMessages(store.transcript.messages).at(-1)!;
	assertEquals(assistant.activitySummary, {
		duration: "1m 4s",
		stepCount: 2,
		thoughtCount: 2,
		expanded: false,
	});
	const html = renderMessage(assistant);
	assertStringIncludes(html, "completed 2 steps in 1m 4s");
});

test("system messages make share URLs actionable and escape text", () => {
	const html = renderMessage({
		id: "share-1",
		role: "system",
		text: "Share <ready>: https://pi.dev/session/#gist-id",
		timestamp: new Date(0),
	});
	assertStringIncludes(html, "Share &lt;ready&gt;:");
	assertStringIncludes(html, 'href="https://pi.dev/session/#gist-id"');
	assertStringIncludes(html, 'target="_blank"');
});

test("notices show their level, and pi-ui notices default to warning", () => {
	const notice = (level?: AppMessage["level"]) =>
		renderMessage({
			id: "n",
			role: "notice",
			text: "65.0 tps",
			level,
			timestamp: new Date(0),
		});
	assertStringIncludes(notice("info"), 'data-state="info"');
	assertStringIncludes(notice("error"), 'data-state="error"');
	assertStringIncludes(notice(), 'data-state="warning"');
});

test("bodyless tools show only their title", () => {
	const html = renderMessage(tool());
	assertStringIncludes(html, "Read file");
	assertStringExcludes(html, "Working...");
	assertStringExcludes(html, "<details");
});

test("shell tools preserve wrapped title, metadata, and escaped output", () => {
	const html = renderMessage(
		tool({
			format: "output",
			meta: "42ms",
			text: '<script>alert("output")</script>',
			titleParts: [
				{ text: "$ " },
				{ highlight: "bash", mono: true, text: "printf 'a very long command'" },
			],
		}),
	);
	assertStringIncludes(html, "&#x27;a very long command&#x27;");
	assertStringIncludes(html, "42ms");
	assertStringIncludes(html, "&lt;script&gt;");
	assertStringExcludes(html, "<script>");
});

test("codemode reuses highlighted tool titles and nests ordinary tool rows", async () => {
	await loadHighlighter();
	const code = '// preserve comments\ntext("<script>");';
	const message = tool({
		titleParts: toolTitleParts("codemode", { code }),
		text: "parent output",
		format: "output",
		nestedCalls: {
			calls: [
				{
					id: "code/1",
					name: "read",
					arguments: { path: "notes.txt" },
					status: "ok",
					durationMs: 0,
				},
				{
					id: "code/2",
					name: "read",
					status: "unfinished",
					argumentsBytes: 100_000,
				},
			],
			complete: false,
		},
	});
	const html = renderMessage(message);
	assertEquals(html.match(/id="message-tool-1"/g)?.length, 1);
	for (const text of [
		"Nested tool calls",
		"notes.txt",
		"0ms",
		"unfinished",
		"arguments omitted: 100000 bytes",
		"Nested call record is incomplete.",
		"parent output",
		"color:light-dark(",
		"// preserve comments",
		"&lt;script&gt;",
	])
		assertStringIncludes(html, text);
	assertStringIncludes(html, 'id="message-tool-1-code/1"');
	assertStringExcludes(html, "<script>");
	assertStringExcludes(html, "tool-pre-output");
	assertStringExcludes(html, "tool-title-compact");
	const running = renderMessage({ ...message, state: "running" });
	assertStringIncludes(running, 'aria-label="Running"');
	assertStringExcludes(running, "unfinished");
});

test.each(["read", "bash", "codemode"])(
	"compact %s rows keep duration after the title",
	(name) => {
		const html = renderMessage(
			tool({
				titleParts: toolTitleParts(name, {
					path: "file.ts",
					command: "echo hello",
					code: "text(42);",
				}),
				meta: "4.1s",
			}),
			true,
		);
		const compact =
			html.match(/<p class="tool-title-compact"[^>]*>[\s\S]*?<\/p>/)?.[0] ?? "";
		assertStringIncludes(compact, '<span class="tool-meta">4.1s</span></p>');
	},
);

test.each(["bash", "codemode"])(
	"compact %s previews omit long source, later lines, outputs, and nested rows",
	async (name) => {
		await loadHighlighter();
		const source = `text("${"😀".repeat(300)}hidden_tail");\ntext("hidden_line");`;
		const message = tool({
			titleParts: toolTitleParts(name, { command: source, code: source }),
			text: "hidden_output",
			format: "output",
			nestedCalls: {
				complete: true,
				calls: [
					{
						id: "nested_hidden",
						name: "read",
						arguments: { path: "hidden_path" },
						status: "ok",
					},
				],
			},
		});
		const compact = renderMessage(message, true);
		for (const hidden of [
			"hidden_tail",
			"hidden_line",
			"hidden_output",
			"hidden_path",
			"nested_hidden",
			"tool-header",
			"�",
		])
			assertStringExcludes(compact, hidden);
		for (const visible of ["😀", "…", "color:light-dark(", "tool-title-compact"])
			assertStringIncludes(compact, visible);
		const expanded = renderMessage(message);
		for (const full of ["hidden_tail", "hidden_line", "hidden_output", "hidden_path"])
			assertStringIncludes(expanded, full);
		assertStringExcludes(expanded, "tool-title-compact");
	},
);

test("compact plain input and fallback titles stay bounded and escaped", () => {
	const source = `<script>${"a".repeat(300)}hidden_tail`;
	for (const message of [
		tool({ title: source }),
		tool({ titleParts: [{ text: source, mono: true }] }),
	]) {
		const compact = renderMessage(message, true);
		assertStringIncludes(compact, "&lt;script&gt;");
		assertStringIncludes(compact, "…");
		assertStringExcludes(compact, "hidden_tail");
		assertStringIncludes(renderMessage(message), "hidden_tail");
	}
});

test("plain tool titles remain escaped", () => {
	const html = renderMessage(tool({ title: '<img src=x onerror="bad">' }));
	assertStringExcludes(html, "<img");
	assertStringIncludes(html, "&lt;img");
});

test("older messages use one wrapper with a load spinner", () => {
	const message: AppMessage = {
		id: "user-1",
		role: "user",
		text: "hello",
		timestamp: new Date(0),
	};
	const html = renderMessages([message], { description: "Send", keys: "enter" }, true);
	assertStringIncludes(html, "data-indicator:_history-loading");
	assertStringIncludes(html, 'data-show="$_historyLoading"');
	assertStringIncludes(html, "@post('/messages/older'");
	assertStringIncludes(html, "data-on:scroll=");
	assertStringIncludes(html, "checkOlder()");
	assertStringIncludes(html, "!$_historyLoading");
	assertStringIncludes(html, "Loading older messages");
	const idle = renderMessages([message], { description: "Send", keys: "enter" }, false);
	assertStringIncludes(idle, 'id="older-messages-trigger"');
	assertStringExcludes(idle, 'data-active="1"');
	assertStringExcludes(idle, "@post('/messages/older'");
});

test("thought visibility does not wait for per-row signal effects", () => {
	const html = renderMessage({
		id: "thought-1",
		role: "thought",
		text: "**reasoning**",
		timestamp: new Date(0),
	});
	assertStringIncludes(html, 'id="message-thought-1"');
	assertStringIncludes(html, 'class="thought-content"');
	assertStringIncludes(html, "<strong>reasoning</strong>");
	assertStringExcludes(html, "data-show");
	assertStringExcludes(html, "data-ignore-morph");
});

test("partial recent sessions stay visible during full catalog loading", () => {
	const loading = renderMessages(
		[],
		{ description: "Send", keys: "enter" },
		false,
		[
			{
				path: "/sessions/recent.jsonl",
				cwd: "/workspace",
				title: "Recent session",
				messageCount: 1,
				modified: "Now",
			},
		],
		true,
		true,
	);
	assertStringIncludes(loading, "Recent session");
	assertStringExcludes(loading, 'aria-label="Loading recent sessions"');
});

test("collapsed thinking renders expandable details with active and completed states", () => {
	const store = new AppStore();
	store.thinkingHidden = true;
	const renderer = new MessageRenderService(store, () => {});
	const thoughtId = store.transcript.appendMessage(
		"thought",
		"# Inspecting layout\nChecking margins",
	);
	const streaming = renderer.renderMessageElement(thoughtId)!;
	assertStringIncludes(streaming, "thought-details");
	assertStringIncludes(streaming, 'data-state="running"');
	assertStringIncludes(streaming, "thinking...");
	assertStringIncludes(streaming, "Inspecting layout");

	store.transcript.finishAssistant();
	const finished = renderer.renderMessageElement(thoughtId)!;
	assertStringIncludes(finished, 'data-state="success"');
	assertStringIncludes(finished, "<span>thought</span>");
});

test("compact tool output shows summary badges, auto-expands errors, and toggles one tool", () => {
	const store = new AppStore();
	store.toolOutputHidden = true;
	const patched: string[] = [];
	const renderer = new MessageRenderService(
		store,
		(_html, selector) => {
			patched.push(selector);
		},
		{},
		{ schedule: () => {}, flush: () => renderer.patchChangedMessages(false) },
	);
	store.transcript.replaceMessages([
		{
			role: "tool",
			title: "edit app.ts",
			timestamp: new Date(0),
			text: "--- a/app.ts\n+++ b/app.ts\n-old\n+new\n+more",
			format: "diff",
			state: "success",
		},
		{
			role: "tool",
			title: "bash",
			timestamp: new Date(1_000),
			text: "command failed\nexit code 1",
			format: "output",
			state: "error",
		},
	]);
	const [editMsg, errorMsg] = store.transcript.messages;
	const compactEdit = renderer.renderMessageElement(editMsg!.id)!;
	assertStringIncludes(compactEdit, "tool-compact-toggle");
	assertStringIncludes(compactEdit, "+2 -1");
	assertStringExcludes(compactEdit, "tool-header");

	const expandedError = renderer.renderMessageElement(errorMsg!.id)!;
	assertStringIncludes(expandedError, "tool-header");
	assertStringIncludes(expandedError, "command failed");
	assertStringIncludes(expandedError, "tool-collapse-button");

	renderer.toggleMessageExpand(editMsg!.id);
	assertEquals(patched, [`#message-${editMsg!.id}`]);
	const expandedEdit = renderer.renderMessageElement(editMsg!.id)!;
	assertStringIncludes(expandedEdit, "tool-header");
	assertStringIncludes(expandedEdit, "tool-collapse-button");

	renderer.toggleMessageExpand(errorMsg!.id);
	const collapsedError = renderer.renderMessageElement(errorMsg!.id)!;
	assertStringIncludes(collapsedError, "tool-compact-toggle");
	assertStringIncludes(collapsedError, "2 lines");
});

test("minimal mode summarizes thinking-only turns, skips hidden thought markdown, and expands turns", () => {
	const store = new AppStore();
	store.minimalMode = true;
	const patched: string[] = [];
	const renderer = new MessageRenderService(
		store,
		(_html, selector) => {
			patched.push(selector);
		},
		{},
		{ schedule: () => {}, flush: () => renderer.patchChangedMessages(false) },
	);
	store.transcript.replaceMessages([
		{ role: "user", text: "explain", timestamp: new Date(0) },
		{ role: "thought", text: "**secret reasoning**", timestamp: new Date(1_000) },
		{ role: "assistant", text: "answer", timestamp: new Date(5_000) },
	]);
	const [, thought, assistant] = store.transcript.messages;
	const hiddenThought = renderer.renderMessageElement(thought!.id)!;
	assertStringExcludes(hiddenThought, "secret reasoning");
	assertStringIncludes(hiddenThought, "minimal-activity");

	const summaryHtml = renderer.renderMessageElement(assistant!.id)!;
	assertStringIncludes(summaryHtml, "thought for 4s");
	assertStringIncludes(summaryHtml, 'aria-expanded="false"');

	renderer.toggleMessageExpand(assistant!.id);
	assertEquals(patched, [`#message-${assistant!.id}`, `#message-${thought!.id}`]);
	const expandedSummary = renderer.renderMessageElement(assistant!.id)!;
	assertStringIncludes(expandedSummary, 'aria-expanded="true"');
	const expandedThought = renderer.renderMessageElement(thought!.id)!;
	assertStringIncludes(expandedThought, "minimal-turn-expanded");
	assertStringIncludes(expandedThought, "<strong>secret reasoning</strong>");
});
