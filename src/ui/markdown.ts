import {
	defineHastPlugin,
	defineMdastPlugin,
	markdownToHtml,
	type CompileOptions,
} from "satteri";
import {
	bundledLanguages,
	createHighlighter,
	type BundledLanguage,
	type Highlighter,
} from "shiki";

import { escapeHtml } from "../utils/html.ts";

const streamingCache = new Map<string, string>();
const highlightedCache = new Map<string, string>();
let highlighterPromise: Promise<Highlighter> | undefined;

const stripRawHtml = defineMdastPlugin({
	name: "pi-ui-strip-raw-html",
	html(node, ctx) {
		ctx.removeNode(node);
	},
});

const safeLinksAndImages = defineHastPlugin({
	name: "pi-ui-safe-links-and-images",
	element: {
		filter: ["a", "img"],
		visit(node, ctx) {
			if (node.tagName === "a") {
				const href = stringProperty(node.properties.href);
				if (!href || !safeUrl(href, { allowDataImage: false })) {
					ctx.removeNode(node);
					return;
				}
				ctx.setProperty(node, "target", "_blank");
				ctx.setProperty(node, "rel", "noreferrer");
			}

			if (node.tagName === "img") {
				const src = stringProperty(node.properties.src);
				if (!src || !safeUrl(src, { allowDataImage: true })) {
					ctx.removeNode(node);
				}
			}
		},
	},
	raw(node, ctx) {
		ctx.removeNode(node);
	},
});

const compileOptions = {
	features: {
		frontmatter: false,
		gfm: true,
		headingAttributes: false,
		math: false,
		smartPunctuation: true,
	},
	hastPlugins: [safeLinksAndImages],
	mdastPlugins: [stripRawHtml],
} satisfies CompileOptions;

export function renderMarkdownStreaming(markdown: string): string {
	const cached = streamingCache.get(markdown);
	if (cached) {
		return cached;
	}
	const html = compileMarkdown(markdown);
	streamingCache.set(markdown, html);
	return html;
}

export async function renderMarkdownFinal(markdown: string): Promise<string> {
	const cached = highlightedCache.get(markdown);
	if (cached) {
		return cached;
	}
	const html = await highlightCodeBlocks(compileMarkdown(markdown));
	highlightedCache.set(markdown, html);
	return html;
}

function compileMarkdown(markdown: string): string {
	const result = markdownToHtml(markdown, compileOptions);
	return result.html;
}

async function highlightCodeBlocks(html: string): Promise<string> {
	const blocks = [
		...html.matchAll(
			/<pre><code class="language-([^"]*)">([\s\S]*?)<\/code><\/pre>/g,
		),
	];
	if (blocks.length === 0) {
		return html;
	}

	let highlighted = html;
	for (const block of blocks) {
		const [raw, rawLanguage, rawCode] = block;
		const language = normalizeLanguage(rawLanguage);
		const replacement = await highlightCode(decodeHtml(rawCode), language);
		highlighted = highlighted.replace(raw, replacement);
	}
	return highlighted;
}

async function highlightCode(code: string, language: string): Promise<string> {
	if (!isBundledLanguage(language)) {
		return fallbackCode(code, language);
	}

	try {
		const highlighter = await getHighlighter();
		if (!highlighter.getLoadedLanguages().includes(language)) {
			await highlighter.loadLanguage(language);
		}
		return highlighter.codeToHtml(code, {
			lang: language,
			theme: "github-dark-default",
		});
	} catch {
		return fallbackCode(code, language);
	}
}

function getHighlighter(): Promise<Highlighter> {
	highlighterPromise ??= createHighlighter({
		langs: [
			"bash",
			"css",
			"diff",
			"html",
			"javascript",
			"json",
			"markdown",
			"shellscript",
			"tsx",
			"typescript",
		],
		themes: ["github-dark-default"],
	});
	return highlighterPromise;
}

function fallbackCode(code: string, language: string): string {
	return `<pre><code class="language-${escapeHtml(language)}">${escapeHtml(code)}</code></pre>`;
}

function normalizeLanguage(language: string | undefined): string {
	const value = language?.trim().split(/\s+/)[0]?.toLowerCase() ?? "";
	if (value === "") {
		return "text";
	}
	if (value === "js") {
		return "javascript";
	}
	if (value === "ts") {
		return "typescript";
	}
	if (value === "sh" || value === "shell") {
		return "shellscript";
	}
	if (value === "md") {
		return "markdown";
	}
	return value;
}

function isBundledLanguage(language: string): language is BundledLanguage {
	return language in bundledLanguages;
}

function safeUrl(value: string, options: { allowDataImage: boolean }): boolean {
	try {
		const url = new URL(value, "http://pi-ui.local");
		if (url.protocol === "data:") {
			return (
				options.allowDataImage &&
				/^data:image\/(png|jpeg|gif|webp);base64,/i.test(value)
			);
		}
		return ["http:", "https:", "mailto:"].includes(url.protocol);
	} catch {
		return false;
	}
}

function stringProperty(value: unknown): string | undefined {
	return typeof value === "string" ? value : undefined;
}

function decodeHtml(value: string): string {
	return value
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">")
		.replaceAll("&quot;", '"')
		.replaceAll("&#39;", "'")
		.replaceAll("&#x27;", "'")
		.replaceAll("&amp;", "&");
}
