import { test } from "bun:test";

import {
	assertEquals as assertEqual,
	assertStringIncludes as assertIncludes,
} from "#testing/assertions";

import { assertStringExcludes as assertNotIncludes } from "../testing/assertions.ts";
import { loadPierreLanguage, preloadPierreHighlighter } from "./diffs.ts";
import {
	markdownCacheStatsForTest,
	releaseMarkdownStreamingState,
	renderMarkdownFinal,
	renderMarkdownStreaming,
} from "./markdown.tsx";

test("streaming cache keeps one entry per stable message key", () => {
	const baseline = markdownCacheStatsForTest().streamingEntries;
	const first = renderMarkdownStreaming("Hello", { cacheKey: "cache-test-1" });
	const repeated = renderMarkdownStreaming("Hello", {
		cacheKey: "cache-test-1",
	});
	assertEqual(repeated, first);
	renderMarkdownStreaming("Hello, world", { cacheKey: "cache-test-1" });
	assertEqual(markdownCacheStatsForTest().streamingEntries, baseline + 1);

	renderMarkdownStreaming("Other", { cacheKey: "cache-test-2" });
	releaseMarkdownStreamingState("cache-test-1");
	assertEqual(markdownCacheStatsForTest().streamingEntries, baseline + 1);
	releaseMarkdownStreamingState("cache-test-2");
	assertEqual(markdownCacheStatsForTest().streamingEntries, baseline);
});

test("streaming without a key does not retain output", () => {
	const before = markdownCacheStatsForTest().streamingEntries;
	renderMarkdownStreaming("uncached");
	assertEqual(markdownCacheStatsForTest().streamingEntries, before);
});

test("streaming code stays visible while its language loads", async () => {
	await loadPierreLanguage("bash");
	const key = "loading-language";
	const html = renderMarkdownStreaming("```odin\npackage main", { cacheKey: key });
	assertIncludes(html, '<code class="language-odin">package main</code>');
	await loadPierreLanguage("odin");
	releaseMarkdownStreamingState(key);
});

test("markdown fallback and final rendering reject unsafe HTML and URLs", async () => {
	const markdown =
		'<script>alert("xss")</script>\n\n[unsafe label](javascript:alert(1)) ![bad image](data:text/html,bad) [local file](file:///tmp/example.txt)';
	for (const html of [
		renderMarkdownStreaming(markdown),
		await renderMarkdownFinal(markdown),
	]) {
		assertNotIncludes(html, "<script>");
		assertIncludes(html, "&lt;script&gt;");
		assertNotIncludes(html, "javascript:");
		assertNotIncludes(html, "data:text/html");
		assertIncludes(html, "<span>unsafe label</span>");
		assertNotIncludes(html, 'href="file:///tmp/example.txt"');
		assertIncludes(html, 'href="#"');
		assertIncludes(html, 'data-pi-file-link="file:///tmp/example.txt"');
		assertIncludes(html, "local file");
	}
});

test("plain, fenced, and incomplete markdown preserve rendering structure", async () => {
	const plainStreaming = renderMarkdownStreaming("Hello **world**");
	const plainFinal = await renderMarkdownFinal("Hello **world**");
	assertEqual(plainStreaming, plainFinal);
	assertIncludes(plainFinal, "<strong>world</strong>");

	for (const [alias, language] of [
		["ts", "typescript"],
		["js", "javascript"],
		["md", "markdown"],
		["sh", "shellscript"],
		["py", "python"],
		["rs", "rust"],
		["tf", "terraform"],
		["yml", "yaml"],
	] as const) {
		const fenced = await renderMarkdownFinal(
			`\`\`\`${alias}\nconst value = 1;\n\`\`\``,
		);
		assertIncludes(fenced, "data-code-block");
		assertIncludes(fenced, `>${language}</span>`);
		assertIncludes(fenced, "const value = 1;");
	}

	const unknown = await renderMarkdownFinal("```not-a-language\nvalue\n```");
	assertIncludes(unknown, ">text</span>");

	for (const unlabeled of [
		renderMarkdownStreaming("```\nvalue\n```"),
		await renderMarkdownFinal("```\nvalue\n```"),
	]) {
		assertIncludes(unlabeled, "data-code-block");
		assertIncludes(unlabeled, ">text</span>");
	}

	const incomplete = renderMarkdownStreaming("```ts\nconst value = 1;");
	assertIncludes(incomplete, "data-code-block");
	assertIncludes(incomplete, "const value = 1;");

	const table = "| Name | Value |\n| --- | --- |\n| cadence | measured |";
	const streamingTable = renderMarkdownStreaming(table);
	assertEqual(streamingTable, await renderMarkdownFinal(table));
	assertIncludes(streamingTable, 'class="table-container');
	assertIncludes(streamingTable, 'class="table min-w-max');
});

test("growing streaming code fences preserve the latest complete source", () => {
	const key = "continuity";
	renderMarkdownStreaming("```ts\nconst first = 1;", { cacheKey: key });
	const latest = renderMarkdownStreaming(
		"```ts\nconst first = 1;\nconst latest = 2;\n```",
		{ cacheKey: key },
	);
	assertIncludes(latest, "const first = 1;");
	assertIncludes(latest, "const latest = 2;");
	releaseMarkdownStreamingState(key);
});

test("code blocks omit the parser-added terminal display line", async () => {
	await preloadPierreHighlighter();
	const markdown = "```ts\none\n\nthree\n```";
	const key = "terminal-newline";
	const streaming = renderMarkdownStreaming(markdown, { cacheKey: key });
	assertEqual(streaming.match(/streaming-code-line-number/g)?.length, 3);
	releaseMarkdownStreamingState(key);

	const final = await renderMarkdownFinal(markdown);
	assertEqual(final.match(/<div data-line="\d+"/g)?.length, 3);
});
