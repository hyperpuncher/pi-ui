import { assert, assertEquals, assertStringIncludes } from "@std/assert";

import type { AppMessage } from "../state/app-store.ts";
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

Deno.test("messages and prompt consume distinct width tokens", async () => {
	const html = renderMessages([], { description: "Send", keys: "enter" });
	assertStringIncludes(html, "--pi-messages-max-width");
	const promptSource = await Deno.readTextFile(
		new URL("./prompt-box.tsx", import.meta.url),
	);
	assert(promptSource.includes("--pi-prompt-max-width"));
	assertEquals(promptSource.includes("--pi-messages-max-width"), false);
});
