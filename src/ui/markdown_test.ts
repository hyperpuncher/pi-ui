import {
	markdownCacheStatsForTest,
	releaseMarkdownStreamingState,
	renderMarkdownFinal,
	renderMarkdownStreaming,
} from "./markdown.tsx";

Deno.test("streaming cache keeps one entry per stable message key", () => {
	const first = renderMarkdownStreaming("Hello", { cacheKey: "cache-test-1" });
	const repeated = renderMarkdownStreaming("Hello", { cacheKey: "cache-test-1" });
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

Deno.test("plain, fenced, and incomplete markdown preserve rendering structure", async () => {
	const plainStreaming = renderMarkdownStreaming("Hello **world**");
	const plainFinal = await renderMarkdownFinal("Hello **world**");
	assertEqual(plainStreaming, plainFinal);
	assertIncludes(plainFinal, "<strong>world</strong>");

	const fenced = await renderMarkdownFinal("```ts\nconst value = 1;\n```");
	assertIncludes(fenced, "data-code-block");
	assertIncludes(fenced, "const value = 1;");

	const incomplete = renderMarkdownStreaming("```ts\nconst value = 1;");
	assertIncludes(incomplete, "data-code-block");
	assertIncludes(incomplete, "const value = 1;");
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
