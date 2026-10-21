// Usage: bun scripts/bench-real-session.ts <session.jsonl> [visibleCount]
// visibleCount=0 renders every Markdown message; >0 renders the last N messages and tools.
import { SessionManager } from "@earendil-works/pi-coding-agent";

import { TranscriptProjector } from "#src/agent/transcript-projector.ts";
import { highlightBash, highlightCodemode } from "#src/ui/bash-highlight.ts";
import { loadPierreLanguage, renderPierreCode, renderPierreDiff } from "#src/ui/diffs.ts";
import { renderMarkdownFinal, renderMarkdownStreaming } from "#src/ui/markdown.tsx";

const sessionPath = process.argv[2];
const visibleCount = Number(process.argv[3] ?? 30);
if (!sessionPath) throw new Error("usage: bun scripts/bench-real-session.ts <session>");

const markdownRoles = new Set(["assistant", "thought", "compaction", "summary", "skill"]);
const memory = () => {
	const value = process.memoryUsage();
	return { rss: value.rss, heapUsed: value.heapUsed, external: value.external };
};

globalThis.Bun.gc?.(true);
const started = performance.now();
const manager = SessionManager.open(sessionPath);
const entries = manager.getEntries();
const opened = performance.now();
const projector = new TranscriptProjector();
const pending = new Map();
const messages = entries.flatMap((entry) => projector.entry(entry, pending));
const projected = performance.now();
await loadPierreLanguage("bash");
const preloaded = performance.now();

const visible = visibleCount > 0 ? messages.slice(-visibleCount) : messages;
const measureTools = visibleCount > 0;
const markdown = visible.filter(
	(message) => markdownRoles.has(message.role) && message.text.trim(),
);
let streamingBytes = 0;
for (const [index, message] of markdown.entries()) {
	if (!measureTools) break;
	streamingBytes += renderMarkdownStreaming(message.text, {
		cacheKey: `bench-stream-${index}`,
	}).length;
}
const streamed = performance.now();

let finalBytes = 0;
for (const [index, message] of markdown.entries())
	finalBytes += (
		await renderMarkdownFinal(message.text, { cacheKey: `bench-final-${index}` })
	).length;
const finalized = performance.now();

let toolBytes = 0;
for (const message of visible) {
	if (!measureTools || message.role !== "tool") continue;
	if (message.format === "diff")
		toolBytes += (await renderPierreDiff(message.text))?.length ?? 0;
	else if (message.format === "code")
		toolBytes += (await renderPierreCode(message.text, "bash")).length;
	for (const part of message.titleParts ?? []) {
		if (part.highlight === "bash") {
			const result = highlightBash(part.text, { format: true });
			toolBytes += result?.tokens.flat().length ?? 0;
		} else if (part.highlight === "javascript") {
			const result = highlightCodemode(part.text);
			toolBytes += result?.tokens.flat().length ?? 0;
		}
	}
}
const enhanced = performance.now();
globalThis.Bun.gc?.(true);

console.log(
	JSON.stringify({
		session: sessionPath,
		fileBytes: Bun.file(sessionPath).size,
		entries: entries.length,
		messages: messages.length,
		visible: visible.length,
		markdownMessages: markdown.length,
		markdownBytes: markdown.reduce((sum, message) => sum + message.text.length, 0),
		timings: {
			openMs: opened - started,
			projectMs: projected - opened,
			preloadMs: preloaded - projected,
			streamingMs: streamed - preloaded,
			finalMs: finalized - streamed,
			toolMs: enhanced - finalized,
			totalMs: enhanced - started,
		},
		outputBytes: {
			streaming: streamingBytes,
			final: finalBytes,
			tool: toolBytes,
		},
		memory: memory(),
	}),
);
