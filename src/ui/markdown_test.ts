import { preloadPierreHighlighter } from "./diffs.ts";
import {
	markdownCacheStatsForTest,
	releaseMarkdownStreamingState,
	renderMarkdownFinal,
	renderMarkdownStreaming,
} from "./markdown.tsx";

Deno.test("streaming cache keeps one entry per stable message key", () => {
	const first = renderMarkdownStreaming("Hello", { cacheKey: "cache-test-1" });
	const repeated = renderMarkdownStreaming("Hello", {
		cacheKey: "cache-test-1",
	});
	assertEqual(repeated, first);
	renderMarkdownStreaming("Hello, world", { cacheKey: "cache-test-1" });
	assertEqual(markdownCacheStatsForTest().streamingEntries, 1);

	renderMarkdownStreaming("Other", { cacheKey: "cache-test-2" });
	releaseMarkdownStreamingState("cache-test-1");
	assertEqual(markdownCacheStatsForTest().streamingEntries, 1);
	releaseMarkdownStreamingState("cache-test-2");
	assertEqual(markdownCacheStatsForTest().streamingEntries, 0);
});

Deno.test("streaming without a key does not retain output", () => {
	const before = markdownCacheStatsForTest().streamingEntries;
	renderMarkdownStreaming("uncached");
	assertEqual(markdownCacheStatsForTest().streamingEntries, before);
});

Deno.test("markdown fallback and final rendering reject unsafe HTML and URLs", async () => {
	const markdown =
		'<script>alert("xss")</script> [bad](javascript:alert(1)) ![bad](data:text/html,bad)';
	for (const html of [
		renderMarkdownStreaming(markdown),
		await renderMarkdownFinal(markdown),
	]) {
		assertNotIncludes(html, "<script>");
		assertNotIncludes(html, "javascript:");
		assertNotIncludes(html, "data:text/html");
	}
});

Deno.test("plain, fenced, and incomplete markdown preserve rendering structure", async () => {
	const plainStreaming = renderMarkdownStreaming("Hello **world**");
	const plainFinal = await renderMarkdownFinal("Hello **world**");
	assertEqual(plainStreaming, plainFinal);
	assertIncludes(plainFinal, "<strong>world</strong>");

	for (const [alias, language] of [
		["ts", "typescript"],
		["js", "javascript"],
		["md", "markdown"],
	] as const) {
		const fenced = await renderMarkdownFinal(
			`\`\`\`${alias}\nconst value = 1;\n\`\`\``,
		);
		assertIncludes(fenced, "data-code-block");
		assertIncludes(fenced, `>${language}</span>`);
		assertIncludes(fenced, "const value = 1;");
	}

	const incomplete = renderMarkdownStreaming("```ts\nconst value = 1;");
	assertIncludes(incomplete, "data-code-block");
	assertIncludes(incomplete, "const value = 1;");

	const table = "| Name | Value |\n| --- | --- |\n| cadence | measured |";
	assertEqual(renderMarkdownStreaming(table), await renderMarkdownFinal(table));
});

Deno.test("growing streaming code fences preserve the latest complete source", () => {
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

Deno.test("streaming code blocks omit the terminal empty display line", async () => {
	await preloadPierreHighlighter();
	const key = "terminal-newline";
	const html = renderMarkdownStreaming("```ts\none\n\nthree\n```", {
		cacheKey: key,
	});
	assertEqual(html.match(/streaming-code-line-number/g)?.length, 3);
	releaseMarkdownStreamingState(key);
});

function assertEqual(actual: unknown, expected: unknown): void {
	if (!Object.is(actual, expected)) {
		throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
	}
}

function assertIncludes(actual: string, expected: string): void {
	if (!actual.includes(expected)) {
		throw new Error(`Expected output to include ${JSON.stringify(expected)}`);
	}
}

function assertNotIncludes(actual: string, expected: string): void {
	if (actual.includes(expected)) {
		throw new Error(`Expected output not to include ${JSON.stringify(expected)}`);
	}
}
