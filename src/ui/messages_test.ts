import { test } from "bun:test";

import { assert, assertEquals, assertStringIncludes } from "#testing/assertions";

import { AppStore } from "../state/app-store.ts";
import { assertStringExcludes } from "../testing/assertions.ts";
import { MessageRenderService } from "./message-render-service.ts";
import { renderMessage, renderMessages } from "./messages.tsx";
import type { AppMessage } from "./render-state.ts";

function tool(overrides: Partial<AppMessage> = {}): AppMessage {
	return {
		id: "tool-1",
		presentationState: "final",
		presentationVersion: 1,
		role: "tool",
		state: "success",
		text: "",
		timestamp: new Date(0),
		title: "Read file",
		...overrides,
	};
}

test("user messages wrap uninterrupted content", () => {
	const html = renderMessage({
		id: "user-1",
		presentationState: "plain",
		presentationVersion: 1,
		role: "user",
		text: "x".repeat(200),
		timestamp: new Date(0),
	});
	assertStringIncludes(html, "wrap-anywhere");
});

test("user messages render attached images without placeholder text", () => {
	const html = renderMessage({
		id: "user-image",
		presentationState: "plain",
		presentationVersion: 1,
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
			presentationState: "plain",
			presentationVersion: 1,
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
		'src="/sessions/image?id=one"',
	);
	assertStringIncludes(html, "flex-col items-end gap-2");
	assertStringIncludes(html, "rounded-xl bg-primary p-1.5");
	assertStringIncludes(html, "notes.txt");
	assertStringIncludes(html, "h-16");
	assertStringIncludes(html, "bg-card");
	assertStringIncludes(html, "rounded-lg border bg-muted");
	assertStringIncludes(html, "check this");
	assertStringExcludes(html, "[image:");
});

test("message projection replaces inline image data with stable URLs", () => {
	const store = new AppStore();
	let registrations = 0;
	const renderer = new MessageRenderService(
		store,
		() => {},
		() => {},
		{
			registerImage: () => {
				registrations += 1;
				return "/sessions/image?id=one";
			},
		},
	);
	store.transcript.replaceMessages([
		{
			role: "user",
			text: "",
			attachments: [
				{
					name: "image.png",
					image: { data: "aW1hZ2U=", mimeType: "image/png" },
				},
			],
			timestamp: new Date(0),
		},
	]);
	const message = renderer.projectMessages(store.transcript.messages)[0];
	assertEquals(message.attachments?.[0].image, {
		url: "/sessions/image?id=one",
		mimeType: "image/png",
	});
	renderer.projectMessages(store.transcript.messages);
	assertEquals(registrations, 1);
});

test("assistant messages summarize preceding tool activity", () => {
	const store = new AppStore();
	const renderer = new MessageRenderService(
		store,
		() => {},
		() => {},
	);
	store.transcript.replaceMessages([
		{ role: "user", text: "fix it", timestamp: new Date(0) },
		{ role: "thought", text: "planning", timestamp: new Date(1_000) },
		{ role: "tool", text: "", timestamp: new Date(2_000), title: "read" },
		{ role: "thought", text: "editing", timestamp: new Date(3_000) },
		{ role: "tool", text: "", timestamp: new Date(4_000), title: "edit" },
		{ role: "assistant", text: "done", timestamp: new Date(65_000) },
	]);
	const assistant = renderer.projectMessages(store.transcript.messages).at(-1)!;
	assertEquals(assistant.activitySummary, { duration: "1m 4s", stepCount: 2 });
	const html = renderMessage(assistant);
	assertStringIncludes(html, "completed 2 steps in 1m 4s");
	assertStringIncludes(html, "message-activity-result");
	assertStringIncludes(html, "pi-activity-summary");
	assertStringIncludes(html, "pi-tool-timeline-item");
	assertStringIncludes(html, "pi-tool-state-dot");
});

test("thinking blocks render expanded content and a collapsed label", () => {
	const html = renderMessage({
		id: "thought-1",
		presentationState: "plain",
		presentationVersion: 1,
		role: "thought",
		text: "**Planning full validation tests**",
		timestamp: new Date(0),
	});
	assertStringIncludes(html, "<strong>Planning full validation tests</strong>");
	assertStringIncludes(html, "Thinking...");
	assertStringIncludes(html, 'class="m-0 leading-[1.7] font-semibold"');
	assertStringIncludes(html, 'data-show="$_thinkingHidden && !$_minimalMode"');
	assertStringIncludes(html, 'data-show="$_minimalMode"');
	assertStringIncludes(html, "pi-tool-state-dot");
	assertStringIncludes(html, 'aria-label="Thinking"');
	assertStringIncludes(html, 'data-show="!$_thinkingHidden && !$_minimalMode"');
	assertStringExcludes(html, "**Planning");
});

test("cache miss notices have a dedicated spacing class", () => {
	const html = renderMessage({
		id: "notice-1",
		presentationState: "plain",
		presentationVersion: 1,
		role: "notice",
		text: "cache miss after 6m idle",
		timestamp: new Date(0),
	});
	assertStringIncludes(html, "message-notice");
});

test("system messages make share URLs actionable and escape text", () => {
	const html = renderMessage({
		id: "share-1",
		presentationState: "plain",
		presentationVersion: 1,
		role: "system",
		text: "Share <ready>: https://pi.dev/session/#gist-id",
		timestamp: new Date(0),
	});
	assertStringIncludes(html, "Share &lt;ready&gt;:");
	assertStringIncludes(html, 'href="https://pi.dev/session/#gist-id"');
	assertStringIncludes(html, 'target="_blank"');
});

test("provider errors use error styling and alert semantics", () => {
	const html = renderMessage({
		id: "provider-error",
		presentationState: "plain",
		presentationVersion: 1,
		role: "system",
		state: "error",
		text: 'Error: 403: {"type":"RegionError"}',
		timestamp: new Date(0),
	});
	assertStringIncludes(html, "pi-error-foreground");
	assertStringIncludes(html, 'role="alert"');
	assertStringIncludes(html, "Error: 403:");
});

test("skills use the tool timeline without enhancement controls", () => {
	const html = renderMessage({
		id: "skill-1",
		presentationState: "deferred",
		presentationVersion: 1,
		role: "skill",
		text: "Follow these instructions",
		timestamp: new Date(0),
		meta: "kita-html",
	});
	assertStringIncludes(html, "pi-tool-timeline-item");
	assertStringIncludes(html, "pi-tool-output-surface");
	assertStringIncludes(html, ">skill</span>");
	assertStringIncludes(html, "kita-html");
	assert(html.indexOf("skill") < html.indexOf("kita-html"));
	assertStringExcludes(html, "Enhance formatting");
});

test("compactions use the tool timeline without enhancement controls", () => {
	const html = renderMessage({
		id: "compaction-1",
		presentationState: "deferred",
		presentationVersion: 1,
		role: "compaction",
		text: "Conversation summary",
		timestamp: new Date(0),
		meta: "compacted from 57,053 tokens",
	});
	assertStringIncludes(html, "pi-tool-timeline-item");
	assertStringIncludes(html, "pi-tool-output-surface");
	assertStringIncludes(html, ">compaction</span>");
	assertStringIncludes(html, "compacted from 57,053 tokens");
	assertStringExcludes(html, "click to expand");
	assertStringExcludes(html, "Enhance formatting");
});

test("bodyless tools use timeline markup without an output surface", () => {
	const html = renderMessage(tool());
	assertStringIncludes(html, "pi-tool-timeline-item");
	assertStringIncludes(html, "pi-tool-state-dot");
	assertStringIncludes(html, 'data-show="!$_minimalMode && !$_toolOutputHidden"');
	assertStringIncludes(html, 'data-show="$_minimalMode || $_toolOutputHidden"');
	assertStringIncludes(html, "min-w-0 truncate");
	assertStringIncludes(html, "Read file");
	assertStringExcludes(html, "Working...");
	assertStringExcludes(html, "<details");
	assertStringIncludes(html, "min-w-[6ch]");
	assertStringIncludes(html, 'aria-hidden="true"');
	assertStringExcludes(html, "pi-tool-output-surface");
	assertStringExcludes(html, "data-ignore-morph");
});

test("consecutive tools need no backend connector markers", () => {
	const html = renderMessages(
		[tool(), tool({ id: "tool-2" }), tool({ id: "tool-3" })],
		{ description: "Send", keys: "enter" },
	);
	assertStringExcludes(html, "data-tool-continues");
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
	assertStringIncludes(html, "&#39;a very long command&#39;");
	assertEquals(html.match(/printf/g)?.length, 2);
	assertStringIncludes(html, "whitespace-nowrap!");
	assertStringIncludes(html, "42ms");
	assertStringIncludes(html, "&lt;script&gt;");
	assertStringIncludes(html, 'data-init="el.scrollTop = el.scrollHeight; 1"');
	assertStringExcludes(html, "<script>");
});

test("tool formats retain specific hooks inside the shared output surface", () => {
	for (const [format, hook] of [
		["diff", "diff-output"],
		["code", "code-output"],
		["output", "tool-output"],
		["pre", "<pre"],
	] as const) {
		const html = renderMessage(tool({ format, text: "value" }));
		assertStringIncludes(html, "pi-tool-output-surface");
		assertStringIncludes(html, hook);
	}
});

test("running and error tools preserve state semantics", () => {
	const running = renderMessage(tool({ state: "running", meta: "working" }));
	assertStringIncludes(running, "animate-ping");
	assertStringIncludes(running, "transition-opacity");
	assertStringIncludes(running, "text-muted-foreground");
	assertStringIncludes(running, 'aria-label="Running"');
	assertStringIncludes(running, 'role="status"');
	assertEquals(running.match(/pi-tool-status-ball/g)?.length, 3);
	assertStringExcludes(running, "animate-spin");
	assertStringIncludes(running, "working");
	const error = renderMessage(tool({ state: "error" }));
	assertStringIncludes(error, "pi-tool-status-ball");
	assertStringIncludes(error, "pi-tool-status-error");
	assertStringIncludes(error, "opacity-100");
	assertStringIncludes(error, 'aria-label="Failed"');
	assertEquals(error.match(/pi-tool-status-ball/g)?.length, 3);
	assertStringExcludes(error, "animate-ping");
});

test("plain tool titles remain escaped", () => {
	const html = renderMessage(tool({ title: '<img src=x onerror="bad">' }));
	assertStringExcludes(html, "<img");
	assertStringIncludes(html, "&lt;img");
});

test("messages reserve the overlaid prompt when populated", () => {
	const html = renderMessages([], { description: "Send", keys: "enter" });
	assertStringIncludes(html, "messages-stack relative mx-auto min-h-full");
	assertStringIncludes(html, "grid flex-1 place-items-center");
	assertStringIncludes(html, "pt-8 pb-32");
	assertStringExcludes(html, "messages-prompt-spacer");
	assertStringExcludes(html, "100vh");
	const populated = renderMessages(
		[
			{
				id: "user-1",
				presentationState: "plain",
				presentationVersion: 1,
				role: "user",
				text: "hello",
				timestamp: new Date(0),
			},
		],
		{ description: "Send", keys: "enter" },
	);
	assertStringIncludes(populated, "pt-24");
	assertStringIncludes(populated, 'id="messages-prompt-spacer"');
});

test("older messages use one wrapper with prefetch and top triggers", () => {
	const html = renderMessages(
		[
			{
				id: "user-1",
				presentationState: "plain",
				presentationVersion: 1,
				role: "user",
				text: "hello",
				timestamp: new Date(0),
			},
		],
		{ description: "Send", keys: "enter" },
		true,
	);
	const listIndex = html.indexOf('id="message-list"');
	const triggerIndex = html.indexOf('id="older-messages-trigger"');
	const messageIndex = html.indexOf('data-message-id="user-1"');
	assert(listIndex >= 0 && listIndex < triggerIndex && triggerIndex < messageIndex);
	assertEquals(html.match(/data-on-intersect/g)?.length, 2);
	assertStringIncludes(html, "h-[min(50vh,100%)]");
	assertStringIncludes(html, "top: min(250vh, calc(100% - 1px))");
	assertStringExcludes(html, "data-on:scroll");
});

test("recent session loading reserves exactly three rows", () => {
	const loading = renderMessages(
		[],
		{ description: "Send", keys: "enter" },
		false,
		[],
		true,
		true,
	);
	assertStringIncludes(loading, 'aria-label="Loading recent sessions"');
	assertStringIncludes(loading, "h-50");
	assertStringIncludes(loading, "h-44");
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
				subtitle: "1 message",
				modified: "Now",
			},
		],
		true,
		true,
	);
	assertStringIncludes(loading, "Recent session");
	assertStringExcludes(loading, 'aria-label="Loading recent sessions"');
});
