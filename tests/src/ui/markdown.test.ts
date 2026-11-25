import { test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";

import {
	releaseMarkdownStreamingState,
	renderMarkdownFinal,
	renderMarkdownStreaming,
} from "#src/ui/markdown.tsx";
import {
	assertEquals as assertEqual,
	assertStringExcludes as assertNotIncludes,
	assertStringIncludes as assertIncludes,
} from "#testing/assertions";
import { makeTempDir } from "#testing/temp";

function codeText(html: string): string {
	let text = "";
	new HTMLRewriter()
		.on('[data-markdown="code-block"] code', {
			text(chunk) {
				text += chunk.text;
			},
		})
		.transform(html);
	return text;
}

test("restores reuse final Markdown across message IDs without stale output", () => {
	const markdown = "```ts\nconst restored = 1;\n```";
	const cacheKey = "before-restore";
	renderMarkdownStreaming(markdown, { cacheKey });
	const final = renderMarkdownFinal(markdown, { cacheKey });

	const restored = { cacheKey: "after-restore" };
	assertEqual(renderMarkdownStreaming(markdown, restored), final);
	assertIncludes(
		renderMarkdownStreaming(`${markdown}\n\nchanged`, restored),
		"changed",
	);
	releaseMarkdownStreamingState(restored.cacheKey);
});

test("local image sources are served through the file preview route", async () => {
	const dir = await makeTempDir({ prefix: "pi-ui-markdown-image-" });
	const image = join(dir, "shot.png");
	await Bun.write(image, new Uint8Array([0x89, 0x50, 0x4e, 0x47]));
	try {
		const expected = `/files/preview/${image
			.split("/")
			.map(encodeURIComponent)
			.join("/")}`;
		for (const source of [image, `file://${image}`]) {
			for (const html of [
				renderMarkdownStreaming(`![shot](${source})`),
				renderMarkdownFinal(`![shot](${source})`),
			]) {
				assertIncludes(html, `src="${expected}"`);
			}
		}
		const relative = renderMarkdownFinal("![shot](shot.png)", {
			localImageBase: dir,
		});
		assertIncludes(relative, `src="${expected}"`);
	} finally {
		await rm(dir, { recursive: true, force: true });
	}
});

test("missing local images show safe placeholders instead of image sources", () => {
	for (const source of [
		"/definitely/missing/pi-ui-image.png",
		"file:///definitely/missing/pi-ui-image.png",
		"FILE:///definitely/missing/pi-ui-image.png",
		"~/definitely/missing/pi-ui-image.png",
	]) {
		const markdown = `![<script>alert(1)</script> & friends](${source}) ![](${source})`;
		for (const html of [
			renderMarkdownStreaming(markdown),
			renderMarkdownFinal(markdown),
		]) {
			assertEqual(
				html,
				'<p data-markdown="p">[image unavailable: &lt;script&gt;alert(1)&lt;/script&gt; &amp; friends] [image unavailable]</p>\n',
			);
		}
	}
	assertEqual(
		renderMarkdownFinal("![shot](missing.png)", {
			localImageBase: "/definitely/missing",
		}),
		'<p data-markdown="p">[image unavailable: shot]</p>\n',
	);
});

test("network-relative images are not treated as local files", () => {
	const markdown = "![shot](//example.com/image.png)";
	for (const html of [
		renderMarkdownStreaming(markdown),
		renderMarkdownFinal(markdown, { localImageBase: "/definitely/missing" }),
	]) {
		assertNotIncludes(html, "[image unavailable");
		assertNotIncludes(html, "/files/preview/");
	}
});

test("links rewrite local file URIs, open external links in new tabs, and drop unsafe HTML/URLs", () => {
	const markdown =
		'<script>alert("xss")</script>\n\n[unsafe label](javascript:alert(1)) ![bad image](data:text/html,bad) [local file](file:///tmp/example.txt) [site](https://example.com/)';
	for (const html of [
		renderMarkdownStreaming(markdown),
		renderMarkdownFinal(markdown),
	]) {
		assertNotIncludes(html, "<script>");
		assertNotIncludes(html, "javascript:");
		assertNotIncludes(html, "data:text/html");
		assertIncludes(html, '<a data-markdown="a">unsafe label</a>');
		assertNotIncludes(html, 'href="file:///tmp/example.txt"');
		assertIncludes(html, 'href="#" data-pi-file-link="file:///tmp/example.txt"');
		assertIncludes(
			html,
			'href="https://example.com/" target="_blank" rel="noreferrer"',
		);
	}
});

test("fenced code blocks highlight with icon copy buttons and tables use scroll containers", () => {
	const fenced = renderMarkdownFinal("```ts\nconst value = 1;\n```");
	assertIncludes(fenced, 'data-markdown="code-block"');
	assertIncludes(fenced, "data-copy-code");
	assertIncludes(fenced, "data-hl-palette=");
	assertIncludes(fenced, "data-hl=");

	const table = "| Name | Value |\n| --- | --- |\n| cadence | measured |";
	const streamingTable = renderMarkdownStreaming(table);
	assertEqual(streamingTable, renderMarkdownFinal(table));
	assertIncludes(streamingTable, 'class="table-container"');
	assertIncludes(streamingTable, 'data-markdown="table"');
});

test.each([
	["text", "one\n\nthree"],
	["ts", "first\n\nlast\n"],
])(
	"streaming and completed %s code preserve the same source lines",
	(language, source) => {
		const markdown = `\`\`\`${language}\n${source}\n\`\`\``;
		const cacheKey = `source-lines-${language}`;
		renderMarkdownStreaming(`\`\`\`${language}\n${source[0]}`, { cacheKey });
		const streaming = renderMarkdownStreaming(markdown, { cacheKey });
		const final = renderMarkdownFinal(markdown, { cacheKey });
		for (const html of [renderMarkdownStreaming(markdown), streaming, final]) {
			assertEqual(codeText(html).replace(/\n$/, ""), source);
		}
	},
);
