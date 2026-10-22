import { expect, test } from "bun:test";

import {
	releaseMarkdownStreamingState,
	renderMarkdownFinal,
	renderMarkdownStreaming,
} from "#src/ui/markdown.tsx";

const flow =
	"flowchart LR\n  accTitle: Request flow\n  accDescr: The server sends the answer to the browser.\n  A[Server] --> B[Browser]";
const fence = (source: string) => `\`\`\`mermaid\n${source}\n\`\`\``;

test("completed Mermaid fences use SVG in both Markdown paths", async () => {
	const markdown = `before\n\n${fence(flow)}\n\nafter`;
	for (const html of [
		renderMarkdownStreaming(markdown),
		await renderMarkdownFinal(markdown),
	]) {
		expect(html).toContain("<svg");
		expect(html).toContain("Request flow");
		expect(html).toContain("<p>before</p>");
		expect(html).toContain("<p>after</p>");
		expect(html).not.toContain("data-code-block");
	}
});

test("opening a Mermaid fence does not flash an empty code block", () => {
	for (const fence of ["```", "~~~"]) {
		for (let length = 0; length <= "mermaid".length; length++) {
			const html = renderMarkdownStreaming(
				`before\n\n${fence}${"mermaid".slice(0, length)}`,
			);
			expect(html).toContain("<p>before</p>");
			expect(html).not.toMatch(/data-code-block|<svg/);
		}
	}
	expect(renderMarkdownStreaming("```text\nvisible code")).toContain("visible code");
});

test("live diagrams use complete lines and retain the last valid snapshot", () => {
	const options = { cacheKey: "live-lines" };
	const open = "before\n\n```mermaid\nflowchart TD\n A[First]\n";
	const first = renderMarkdownStreaming(open, options);
	expect(first).toContain("<svg");
	expect(first).toContain("First");
	expect(first).toContain("<p>before</p>");
	expect(renderMarkdownStreaming(open + ' B["Second', options)).toBe(first);
	const incomplete = open + ' B["Second\n';
	expect(renderMarkdownStreaming(incomplete, options)).toBe(first);
	const recovered = incomplete + ' line"]\n';
	const second = renderMarkdownStreaming(recovered, options);
	expect(second).toContain("Second");
	expect(second).not.toContain("data-code-block");
	for (const closing of ["`", "``", "```", "```\n"]) {
		expect(renderMarkdownStreaming(recovered + closing, options)).toBe(second);
	}
	releaseMarkdownStreamingState(options.cacheKey);
});

test("draft snapshots do not survive a source replacement or release", () => {
	const options = { cacheKey: "live-reset" };
	const open = "```mermaid\nflowchart TD\n A[Previous]\n";
	const invalid = open + " subgraph Work\n";
	renderMarkdownStreaming(open, options);
	expect(renderMarkdownStreaming(invalid, options)).toContain("Previous");
	expect(renderMarkdownStreaming(invalid, { cacheKey: "live-other" })).not.toContain(
		"<svg",
	);
	const nextBlock = open + "```\n\n```mermaid\nflowchart TD\n subgraph Other\n";
	expect(
		renderMarkdownStreaming(nextBlock, options).match(/class="mermaid-diagram"/g),
	).toHaveLength(1);
	releaseMarkdownStreamingState("live-other");
	releaseMarkdownStreamingState(options.cacheKey);
	expect(renderMarkdownStreaming(invalid, options)).not.toContain("<svg");
	renderMarkdownStreaming(open, options);
	expect(
		renderMarkdownStreaming("```mermaid\nflowchart TD\n subgraph Other\n", options),
	).not.toContain("Previous");
	releaseMarkdownStreamingState(options.cacheKey);
});

test("closing an invalid draft uses the readable code fallback", async () => {
	const options = { cacheKey: "live-invalid" };
	const open = "```mermaid\nflowchart TD\n A[First]\n";
	expect(renderMarkdownStreaming(open, options)).toContain("<svg");
	const closed = open + " subgraph Work\n```\n";
	for (const html of [
		renderMarkdownStreaming(closed, options),
		await renderMarkdownFinal(closed, options),
	]) {
		expect(html).not.toContain('class="mermaid-diagram"');
		expect(html).toContain("data-code-block");
	}
	releaseMarkdownStreamingState(options.cacheKey);
});

test("completed diagrams remain visible while the next diagram streams", () => {
	const html = renderMarkdownStreaming(
		`\`\`\`text\nplain before\n\`\`\`\n\n${fence(flow)}\n\n\`\`\`text\nplain after\n\`\`\`\n\n\`\`\`mermaid\nflowchart TD\n X[Pending]`,
	);
	expect(html.match(/class="mermaid-diagram"/g)).toHaveLength(1);
	expect(html).toContain("plain before");
	expect(html).toContain("plain after");
	expect(html).not.toContain("Pending");
});

test("container and tilde fences follow the Markdown parser", () => {
	for (const markdown of [
		`~~~mermaid\n${flow}\n~~~\n`,
		`> \`\`\`mermaid\n${flow
			.split("\n")
			.map((line) => `> ${line}`)
			.join("\n")}\n> \`\`\`\n`,
		`- diagram\n\n  \`\`\`mermaid\n${flow
			.split("\n")
			.map((line) => `  ${line}`)
			.join("\n")}\n  \`\`\`\n`,
		(fence(flow) + "\n").replaceAll("\n", "\r\n"),
	])
		expect(renderMarkdownStreaming(markdown)).toContain("<svg");
	const quoted = `> \`\`\`mermaid\n> flowchart TD\n> A --> B\n`;
	expect(renderMarkdownStreaming(quoted)).toContain("<svg");
});

test("final answers can render a valid diagram without a closing fence", async () => {
	expect(await renderMarkdownFinal(`\`\`\`mermaid\n${flow}`)).toContain("<svg");
});

test("invalid and oversized diagrams remain readable escaped code", async () => {
	for (const source of [
		"not a diagram </script>",
		`flowchart TD\n%% ${"x".repeat(50_000)}`,
	]) {
		for (const html of [
			renderMarkdownStreaming(fence(source) + "\n"),
			await renderMarkdownFinal(fence(source)),
		]) {
			expect(html).not.toContain('class="mermaid-diagram"');
			expect(html).toContain("data-code-block");
			expect(html).not.toContain("</script>");
		}
	}
});

test("diagrams support links and images while labels remain text", async () => {
	const source =
		'flowchart TD\n  A["<script>alert(1)</script>"] --> B[Safe]\n  click A "https://example.com/"\n  C@{ img: "https://example.com/image.png", label: "Remote" }';
	const html = await renderMarkdownFinal(fence(source));
	const links: (string | null)[] = [];
	const images: (string | null)[] = [];
	const forbidden: string[] = [];
	new HTMLRewriter()
		.on("a", {
			element(element) {
				links.push(element.getAttribute("href"));
			},
		})
		.on("image", {
			element(element) {
				images.push(element.getAttribute("href"));
			},
		})
		.on("script, iframe, foreignObject", {
			element(element) {
				forbidden.push(element.tagName);
			},
		})
		.transform(html);
	expect(links).toEqual(["https://example.com/"]);
	expect(images).toEqual(["https://example.com/image.png"]);
	expect(forbidden).toEqual([]);
});

test("SVG description IDs are stable across streaming and final rendering, and isolated between messages", async () => {
	const markdown = `\`\`\`text\nplain code\n\`\`\`\n\n${fence(flow)}\n`;
	const ids = (html: string) =>
		[...html.matchAll(/aria-labelledby="([^"]+)"/g)].map((match) => match[1]);
	const preview = renderMarkdownStreaming(markdown.replace(/\n```\n$/, "\n"), {
		cacheKey: "first",
	});
	const first = renderMarkdownStreaming(markdown, { cacheKey: "first" });
	const final = await renderMarkdownFinal(markdown, { cacheKey: "first" });
	const second = await renderMarkdownFinal(markdown, { cacheKey: "second" });
	expect(ids(first)).not.toEqual([]);
	expect(ids(preview)).toEqual(ids(first));
	expect(ids(first)).toEqual(ids(final));
	expect(ids(first)).not.toEqual(ids(second));
	const two = ids(
		await renderMarkdownFinal(`${markdown}\n${markdown}`, { cacheKey: "two" }),
	);
	expect(two).toHaveLength(2);
	expect(new Set(two).size).toBe(2);
	releaseMarkdownStreamingState("first");
});
