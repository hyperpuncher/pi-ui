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
	assertStringIncludes(html, "notes.txt");
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
	assertStringIncludes(html, "&#39;a very long command&#39;");
	assertEquals(html.match(/printf/g)?.length, 2);
	assertStringIncludes(html, "42ms");
	assertStringIncludes(html, "&lt;script&gt;");
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
		assertStringIncludes(html, hook);
	}
});

test("plain tool titles remain escaped", () => {
	const html = renderMessage(tool({ title: '<img src=x onerror="bad">' }));
	assertStringExcludes(html, "<img");
	assertStringIncludes(html, "&lt;img");
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
	assertEquals(html.match(/data-indicator:_older-messages-loading/g)?.length, 2);
	assertStringIncludes(html, "Loading older messages");
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
