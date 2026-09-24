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
	assertStringExcludes(html, 'loading="lazy"');
	assertStringExcludes(html, 'decoding="async"');
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

test("notices render in the body font by default, not bold monospace", () => {
	const html = renderMessage({
		id: "notice-1",
		presentationState: "plain",
		presentationVersion: 1,
		role: "notice",
		noticeTone: "info",
		text: "Set to gpt-5.",
		timestamp: new Date(0),
	});
	assertStringIncludes(html, "notice-header");
	assertStringIncludes(html, "notice-title");
	assertStringExcludes(html, "notice-pre");
	assertStringExcludes(html, "tool-header");
	assertStringExcludes(html, "tool-title");
});

test("a pre-formatted notice keeps the monospace treatment", () => {
	const html = renderMessage({
		id: "notice-2",
		presentationState: "plain",
		presentationVersion: 1,
		role: "notice",
		noticeTone: "info",
		format: "pre",
		text: "tokens: 1,234\ncost: $0.01",
		timestamp: new Date(0),
	});
	assertStringIncludes(html, "notice-header notice-pre");
});

test("custom messages render their customType as the label and markdown content", () => {
	const html = renderMessage({
		id: "custom-1",
		presentationState: "plain",
		presentationVersion: 1,
		role: "custom",
		text: "**bold** status",
		meta: "deploy_status",
		timestamp: new Date(0),
	});
	assertStringIncludes(html, "deploy_status");
	assertStringIncludes(html, "<strong>bold</strong>");
	assertStringExcludes(html, "Details");
});

test("custom messages with details render a nested collapsible with escaped text", () => {
	const html = renderMessage({
		id: "custom-2",
		presentationState: "plain",
		presentationVersion: 1,
		role: "custom",
		text: "build failed",
		meta: "ci_result",
		details: '<script>alert("x")</script>\nexit code 1',
		timestamp: new Date(0),
	});
	assertStringIncludes(html, "Details");
	assertStringIncludes(html, "&lt;script&gt;");
	assertStringExcludes(html, "<script>");
});

test("a custom message without a customType falls back to a generic label", () => {
	const html = renderMessage({
		id: "custom-3",
		presentationState: "plain",
		presentationVersion: 1,
		role: "custom",
		text: "hi",
		timestamp: new Date(0),
	});
	assertStringIncludes(html, "custom");
});

test("custom messages (command output such as memory-info, rtk-status) render expanded", () => {
	const html = renderMessage({
		id: "custom-4",
		presentationState: "plain",
		presentationVersion: 1,
		role: "custom",
		text: "3 memories stored",
		meta: "memory-info",
		timestamp: new Date(0),
	});
	assertStringIncludes(html, "<details");
	assertStringIncludes(html, 'data-preserve-attr="open" open>');
});

test("compaction and skill context messages stay collapsed by default", () => {
	const compaction = renderMessage({
		id: "compaction-1",
		presentationState: "plain",
		presentationVersion: 1,
		role: "compaction",
		text: "summary text",
		timestamp: new Date(0),
	});
	assertStringExcludes(compaction, 'data-preserve-attr="open" open>');
	const skill = renderMessage({
		id: "skill-1",
		presentationState: "plain",
		presentationVersion: 1,
		role: "skill",
		text: "skill body",
		timestamp: new Date(0),
	});
	assertStringExcludes(skill, 'data-preserve-attr="open" open>');
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
	assertStringIncludes(html, "42ms");
	assertStringIncludes(html, "&lt;script&gt;");
	assertStringExcludes(html, "<script>");
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

test("stopped replies and thinking blocks show the muted Stopped note", () => {
	for (const role of ["assistant", "thought"] as const) {
		const html = renderMessage({
			id: `${role}-stopped`,
			presentationState: "final",
			presentationVersion: 1,
			role,
			text: "partial",
			meta: "Stopped",
			timestamp: new Date(0),
		});
		assertStringIncludes(html, '<p class="message-stopped-note">Stopped</p>');
	}
	assertStringExcludes(
		renderMessage({
			id: "thought-plain",
			presentationState: "final",
			presentationVersion: 1,
			role: "thought",
			text: "done thinking",
			timestamp: new Date(0),
		}),
		"message-stopped-note",
	);
});
