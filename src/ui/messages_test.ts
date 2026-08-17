import { assert, assertEquals, assertStringIncludes } from "@std/assert";

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

Deno.test("user messages wrap uninterrupted content", () => {
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

Deno.test("user messages render attached images without placeholder text", () => {
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

Deno.test("message projection replaces inline image data with stable URLs", () => {
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

Deno.test("narrative fallback still renders markdown structure", () => {
	const html = renderMessage({
		id: "thought-1",
		presentationState: "plain",
		presentationVersion: 1,
		role: "thought",
		text: "**Planning full validation tests**",
		timestamp: new Date(0),
	});
	assertStringIncludes(html, "<strong>Planning full validation tests</strong>");
	assertStringExcludes(html, "**Planning");
});

Deno.test("cache miss notices have a dedicated spacing class", () => {
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

Deno.test("system messages make share URLs actionable and escape text", () => {
	const html = renderMessage({
		id: "share-1",
		presentationState: "plain",
		presentationVersion: 1,
		role: "system",
		text: "Share <ready>: https://pi.dev/session/#gist-id",
		timestamp: new Date(0),
	});
	assertStringIncludes(html, "Share &lt;ready>:");
	assertStringIncludes(html, 'href="https://pi.dev/session/#gist-id"');
	assertStringIncludes(html, 'target="_blank"');
});

Deno.test("skills use the tool timeline without enhancement controls", () => {
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

Deno.test("compactions use the tool timeline without enhancement controls", () => {
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

Deno.test("bodyless tools use timeline markup without an output surface", () => {
	const html = renderMessage(tool());
	assertStringIncludes(html, "pi-tool-timeline-item");
	assertStringIncludes(html, "pi-tool-state-dot");
	assertStringIncludes(html, "min-w-[6ch]");
	assertStringIncludes(html, 'aria-hidden="true"');
	assertStringExcludes(html, "pi-tool-output-surface");
	assertStringExcludes(html, "data-ignore-morph");
});

Deno.test("consecutive tools mark every continuing timeline segment", () => {
	const html = renderMessages(
		[tool(), tool({ id: "tool-2" }), tool({ id: "tool-3" })],
		{ description: "Send", keys: "enter" },
	);
	assertEquals(html.match(/data-tool-continues/g)?.length, 2);
});

Deno.test("shell tools preserve wrapped title, metadata, and escaped output", () => {
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
	assertStringIncludes(html, "printf &#39;a very long command&#39;");
	assertStringIncludes(html, "42ms");
	assertStringIncludes(html, "&lt;script>");
	assertStringExcludes(html, "<script>");
});

Deno.test("tool formats retain specific hooks inside the shared output surface", () => {
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

Deno.test("running and error tools preserve state semantics", () => {
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

Deno.test("plain tool titles remain escaped", () => {
	const html = renderMessage(tool({ title: '<img src=x onerror="bad">' }));
	assertStringExcludes(html, "<img");
	assertStringIncludes(html, "&lt;img");
});

Deno.test("empty messages center within the padded chat area", () => {
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

Deno.test("older messages use one wrapper with prefetch and top triggers", () => {
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
	const triggerIndex = html.indexOf('id="older-messages-trigger"');
	const messageIndex = html.indexOf('data-message-id="user-1"');
	assert(triggerIndex >= 0 && triggerIndex < messageIndex);
	assertEquals(html.match(/data-on-intersect/g)?.length, 2);
	assertStringIncludes(html, "h-[min(50vh,100%)]");
	assertStringIncludes(html, "top: min(250vh, calc(100% - 1px))");
	assertStringExcludes(html, "data-on:scroll");
});

Deno.test("recent session loading reserves exactly three rows", () => {
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

Deno.test("partial recent sessions stay visible during full catalog loading", () => {
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
