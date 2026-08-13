import { assert, assertEquals, assertFalse, assertStringIncludes } from "@std/assert";

import { type AppMessage, AppStore } from "../state/app-store.ts";
import { MessageRenderService } from "./message-render-service.ts";
import { renderMessage, renderMessages } from "./messages.tsx";

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
	assertStringIncludes(html, 'data-file-kind="text"');
	assertStringIncludes(html, "check this");
	assertFalse(html.includes("[image:"));
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
	assertFalse(html.includes("**Planning"));
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
	assertEquals(html.includes("Enhance formatting"), false);
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
	assertEquals(html.includes("click to expand"), false);
	assertEquals(html.includes("Enhance formatting"), false);
});

Deno.test("bodyless tools use timeline markup without an output surface", () => {
	const html = renderMessage(tool());
	assertStringIncludes(html, "pi-tool-timeline-item");
	assertStringIncludes(html, "pi-tool-state-dot");
	assertStringIncludes(html, "min-w-[6ch]");
	assertStringIncludes(html, 'aria-hidden="true"');
	assertEquals(html.includes("pi-tool-output-surface"), false);
	assertEquals(html.includes("data-ignore-morph"), false);
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
	assertEquals(html.includes("<script>"), false);
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
	assertEquals(running.includes("animate-spin"), false);
	assertStringIncludes(running, "working");
	const error = renderMessage(tool({ state: "error" }));
	assertStringIncludes(error, "pi-tool-status-ball");
	assertStringIncludes(error, "pi-tool-status-error");
	assertStringIncludes(error, "opacity-100");
	assertStringIncludes(error, 'aria-label="Failed"');
	assertEquals(error.match(/pi-tool-status-ball/g)?.length, 3);
	assertEquals(error.includes("animate-ping"), false);
});

Deno.test("plain tool titles remain escaped", () => {
	const html = renderMessage(tool({ title: '<img src=x onerror="bad">' }));
	assertEquals(html.includes("<img"), false);
	assertStringIncludes(html, "&lt;img");
});

Deno.test("empty messages center within the padded chat area", () => {
	const html = renderMessages([], { description: "Send", keys: "enter" });
	assertStringIncludes(html, "messages-stack mx-auto min-h-full");
	assertStringIncludes(html, "grid flex-1 place-items-center");
	assertStringIncludes(html, "pt-8 pb-32");
	assertEquals(html.includes("messages-prompt-spacer"), false);
	assertEquals(html.includes("100vh"), false);
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
	assertFalse(loading.includes('aria-label="Loading recent sessions"'));
});
