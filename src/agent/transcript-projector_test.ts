import { test } from "bun:test";

import type { CustomEntry } from "@earendil-works/pi-coding-agent";

import { assertEquals } from "#testing/assertions";

import { sessionEntryStub } from "./test-fixtures.ts";
import {
	TranscriptProjector,
	type TranscriptCustomRenderers,
} from "./transcript-projector.ts";

const timestamp = new Date("2024-01-01T00:00:00.000Z");

function renderers(
	overrides: Partial<TranscriptCustomRenderers> = {},
): TranscriptCustomRenderers {
	return {
		renderMessage: overrides.renderMessage ?? (() => undefined),
		renderEntry: overrides.renderEntry ?? (() => undefined),
	};
}

test("a custom_message entry with no registered renderer keeps the plain-text fallback", () => {
	const projector = new TranscriptProjector();
	const entry = sessionEntryStub({
		type: "custom_message",
		customType: "memory-info",
		content: "stored 3 memories",
		display: true,
	});
	const [message] = projector.entry(entry, new Map(), undefined, renderers());
	assertEquals(message.role, "custom");
	assertEquals(message.text, "stored 3 memories");
	assertEquals(message.customRenderHtml, undefined);
});

test("a custom_message entry with a registered renderer shows its output instead", () => {
	const projector = new TranscriptProjector();
	const entry = sessionEntryStub({
		type: "custom_message",
		customType: "memory-info",
		content: "stored 3 memories",
		display: true,
	});
	let seenCustomType: string | undefined;
	const [message] = projector.entry(
		entry,
		new Map(),
		undefined,
		renderers({
			renderMessage: (msg) => {
				seenCustomType = msg.customType;
				return { ok: true, lines: ["<b>3</b> memories"] };
			},
		}),
	);
	assertEquals(seenCustomType, "memory-info");
	assertEquals(message.customRenderHtml, ["<b>3</b> memories"]);
	// The plain-text fallback is still computed (cheap, and unused by the
	// renderer path) — harmless, matches the real interactive mode keeping the
	// message object itself unchanged either way.
	assertEquals(message.text, "stored 3 memories");
});

test("a message renderer that throws falls back to plain text silently", () => {
	const projector = new TranscriptProjector();
	const entry = sessionEntryStub({
		type: "custom_message",
		customType: "memory-info",
		content: "stored 3 memories",
		display: true,
	});
	const [message] = projector.entry(
		entry,
		new Map(),
		undefined,
		renderers({ renderMessage: () => ({ ok: false, error: "boom" }) }),
	);
	assertEquals(message.customRenderHtml, undefined);
	assertEquals(message.text, "stored 3 memories");
});

test("a CustomEntry with no registered renderer produces nothing", () => {
	const projector = new TranscriptProjector();
	const entry = sessionEntryStub({
		type: "custom",
		customType: "workflow-help",
	}) as CustomEntry;
	assertEquals(projector.customEntry(entry, timestamp, renderers()), []);
	assertEquals(projector.customEntry(entry, timestamp, undefined), []);
});

test("a CustomEntry renderer returning undefined produces nothing", () => {
	const projector = new TranscriptProjector();
	const entry = sessionEntryStub({
		type: "custom",
		customType: "workflow-help",
	}) as CustomEntry;
	const messages = projector.customEntry(
		entry,
		timestamp,
		renderers({ renderEntry: () => undefined }),
	);
	assertEquals(messages, []);
});

test("a CustomEntry renderer that throws surfaces a visible error line", () => {
	const projector = new TranscriptProjector();
	const entry = sessionEntryStub({
		type: "custom",
		customType: "workflow-help",
	}) as CustomEntry;
	const [message] = projector.customEntry(
		entry,
		timestamp,
		renderers({ renderEntry: () => ({ ok: false, error: "renderer crashed" }) }),
	);
	assertEquals(message.role, "custom");
	assertEquals(message.meta, "workflow-help");
	assertEquals(
		message.customRenderError,
		"[workflow-help] renderer failed: renderer crashed",
	);
	assertEquals(message.customRenderHtml, undefined);
});

test("a CustomEntry renderer that succeeds shows its rendered lines", () => {
	const projector = new TranscriptProjector();
	const entry = sessionEntryStub({
		type: "custom",
		customType: "workflow-help",
	}) as CustomEntry;
	let seen: CustomEntry | undefined;
	const [message] = projector.customEntry(
		entry,
		timestamp,
		renderers({
			renderEntry: (received) => {
				seen = received;
				return { ok: true, lines: ["line one", "line two"] };
			},
		}),
	);
	assertEquals(seen, entry);
	assertEquals(message.role, "custom");
	assertEquals(message.customRenderHtml, ["line one", "line two"]);
	assertEquals(message.customRenderError, undefined);
});

test("TranscriptProjector.entry() dispatches a custom SessionEntry to customEntry()", () => {
	const projector = new TranscriptProjector();
	const entry = sessionEntryStub({
		type: "custom",
		customType: "workflow-help",
	});
	const messages = projector.entry(
		entry,
		new Map(),
		undefined,
		renderers({ renderEntry: () => ({ ok: true, lines: ["hi"] }) }),
	);
	assertEquals(messages.length, 1);
	assertEquals(messages[0]?.customRenderHtml, ["hi"]);
});

test("a live custom AgentMessage is rendered through renderMessage too", () => {
	const projector = new TranscriptProjector();
	const messages = projector.message(
		{
			role: "custom",
			customType: "memory",
			content: "note saved",
			display: true,
			timestamp: timestamp.getTime(),
		},
		timestamp,
		{},
		renderers({ renderMessage: () => ({ ok: true, lines: ["<i>note</i> saved"] }) }),
	);
	assertEquals(messages, [
		{
			role: "custom",
			text: "note saved",
			timestamp,
			meta: "memory",
			details: undefined,
			customRenderHtml: ["<i>note</i> saved"],
		},
	]);
});

test("a live custom AgentMessage with display:false renders nothing, renderer or not", () => {
	const projector = new TranscriptProjector();
	const messages = projector.message(
		{
			role: "custom",
			customType: "memory",
			content: "note saved",
			display: false,
			timestamp: timestamp.getTime(),
		},
		timestamp,
		{},
		renderers({
			renderMessage: () => {
				throw new Error("must not be called for a non-displayed message");
			},
		}),
	);
	assertEquals(messages, []);
});
