import { ShikiStreamTokenizer } from "@shikijs/stream";
import {
	defineHastPlugin,
	defineMdastPlugin,
	markdownToHtml,
	type CompileOptions,
} from "satteri";
import { createHighlighter, type Highlighter, type ThemedToken } from "shiki";

import { escapeHtml } from "../utils/html.ts";

const streamingCache = new Map<string, string>();
const highlightedCache = new Map<string, string>();
const codeBlockCache = new Map<string, string>();
const streamingCodeBlockStates = new Map<string, StreamingCodeBlockState>();
let highlighter: Highlighter | undefined;
let highlighterPromise: Promise<Highlighter> | undefined;

type StreamingCodeBlockState = {
	language: string;
	code: string;
	tokenizer: ShikiStreamTokenizer;
};

const stripRawHtml = defineMdastPlugin({
	name: "pi-ui-strip-raw-html",
	html(node, ctx) {
		ctx.removeNode(node);
	},
});

const basecoatTables = defineHastPlugin({
	name: "pi-ui-basecoat-tables",
	element: {
		filter: ["table", "th", "td"],
		visit(node, ctx) {
			if (node.tagName === "table") {
				ctx.setProperty(
					node,
					"className",
					classes(node.properties.className, [
						"table",
						"w-full",
						"table-fixed",
						"text-sm",
					]),
				);
				ctx.wrapNode(node, {
					type: "element",
					tagName: "div",
					properties: { className: ["table-container"] },
					children: [],
				});
			}

			if (node.tagName === "th") {
				ctx.setProperty(
					node,
					"className",
					classes(node.properties.className, [
						"break-words",
						"px-3",
						"py-2",
						"text-left",
						"align-top",
						"font-semibold",
						"whitespace-normal",
					]),
				);
			}

			if (node.tagName === "td") {
				ctx.setProperty(
					node,
					"className",
					classes(node.properties.className, [
						"break-words",
						"px-3",
						"py-2",
						"align-top",
						"whitespace-normal",
					]),
				);
			}
		},
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
	hastPlugins: [safeLinksAndImages, basecoatTables],
	mdastPlugins: [stripRawHtml],
} satisfies CompileOptions;

export async function preloadMarkdownHighlighter(): Promise<void> {
	highlighter = await getHighlighter();
}

export function renderMarkdownStreaming(
	markdown: string,
	options: { cacheKey?: string } = {},
): string {
	const cacheKey = `${options.cacheKey ?? ""}\0${markdown}`;
	const cached = streamingCache.get(cacheKey);
	if (cached) {
		return cached;
	}
	const html = highlighter
		? highlightCodeBlocks(compileMarkdown(markdown), highlighter, {
				cacheKey: options.cacheKey,
			})
		: compileMarkdown(markdown);
	streamingCache.set(cacheKey, html);
	return html;
}

export async function renderMarkdownFinal(markdown: string): Promise<string> {
	const cached = highlightedCache.get(markdown);
	if (cached) {
		return cached;
	}
	const html = highlightCodeBlocks(compileMarkdown(markdown), await getHighlighter());
	highlightedCache.set(markdown, html);
	return html;
}

function compileMarkdown(markdown: string): string {
	const result = markdownToHtml(markdown, compileOptions);
	return result.html;
}

export async function renderCodeFinal(
	code: string,
	language: string,
	options: { chrome?: boolean } = {},
): Promise<string> {
	return await highlightCode(code, codeFenceLanguage(language), options);
}

function highlightCodeBlocks(
	html: string,
	highlighter: Highlighter,
	options: { cacheKey?: string } = {},
): string {
	const blocks = [
		...html.matchAll(
			/<pre><code class="language-([^"]*)">([\s\S]*?)<\/code><\/pre>/g,
		),
	];
	if (blocks.length === 0) {
		return html;
	}

	let highlighted = html;
	for (const [index, block] of blocks.entries()) {
		const [raw, rawLanguage, rawCode] = block;
		const language = codeFenceLanguage(rawLanguage);
		const code = decodeHtml(rawCode);
		const replacement = options.cacheKey
			? highlightStreamingCodeBlock(
					highlighter,
					code,
					language,
					`${options.cacheKey}:${index}`,
				)
			: cachedHighlightedCodeBlock(highlighter, code, language);
		highlighted = highlighted.replace(raw, replacement);
	}
	return highlighted;
}

async function highlightCode(
	code: string,
	language: string,
	options: { chrome?: boolean } = {},
): Promise<string> {
	return highlightCodeWithHighlighter(await getHighlighter(), code, language, options);
}

function cachedHighlightedCodeBlock(
	highlighter: Highlighter,
	code: string,
	language: string,
): string {
	const key = `${language}\0${code}`;
	const cached = codeBlockCache.get(key);
	if (cached) return cached;

	const highlighted = highlightCodeWithHighlighter(highlighter, code, language, {
		chrome: true,
	});
	codeBlockCache.set(key, highlighted);
	return highlighted;
}

function highlightStreamingCodeBlock(
	highlighter: Highlighter,
	code: string,
	language: string,
	cacheKey: string,
): string {
	let state = streamingCodeBlockStates.get(cacheKey);
	if (!state || state.language !== language || !code.startsWith(state.code)) {
		state = createStreamingCodeBlockState(highlighter, language);
		streamingCodeBlockStates.set(cacheKey, state);
	}

	const chunk = code.slice(state.code.length);
	if (chunk) {
		void state.tokenizer.enqueue(chunk).catch(() => state.tokenizer.clear());
		state.code = code;
	}

	return (
		<CodeBlock
			pre={renderStreamingTokensPre([
				...state.tokenizer.tokensStable,
				...state.tokenizer.tokensUnstable,
			])}
			language={language}
		/>
	) as string;
}

function createStreamingCodeBlockState(
	highlighter: Highlighter,
	language: string,
): StreamingCodeBlockState {
	return {
		language,
		code: "",
		tokenizer: new ShikiStreamTokenizer({
			highlighter,
			lang: language,
			themes: {
				light: "ayu-light",
				dark: "ayu-dark",
			},
		}),
	};
}

function renderStreamingTokensPre(tokens: ThemedToken[]): string {
	return `<pre class="shiki shiki-themes ayu-light ayu-dark" style="background-color:var(--code-background);color:#5C6166" tabindex="0"><code>${tokens
		.map(renderToken)
		.join("")}</code></pre>`;
}

function renderToken(token: ThemedToken): string {
	const style = styleObjectToAttribute(token.htmlStyle ?? tokenStyle(token));
	const styleAttribute = style ? ` style="${escapeHtml(style)}"` : "";
	return `<span${styleAttribute}>${escapeHtml(token.content)}</span>`;
}

function tokenStyle(token: ThemedToken): Record<string, string> {
	const style: Record<string, string> = {};
	if (token.color) style.color = token.color;
	if (token.bgColor) style["background-color"] = token.bgColor;
	return style;
}

function styleObjectToAttribute(style: Record<string, string>): string {
	return Object.entries(style)
		.map(([key, value]) => `${key}:${value}`)
		.join(";");
}

function highlightCodeWithHighlighter(
	highlighter: Highlighter,
	code: string,
	language: string,
	options: { chrome?: boolean } = {},
): string {
	const chrome = options.chrome ?? true;
	try {
		const pre = highlighter.codeToHtml(code, {
			lang: language,
			themes: {
				light: "ayu-light",
				dark: "ayu-dark",
			},
		});
		return chrome ? ((<CodeBlock pre={pre} language={language} />) as string) : pre;
	} catch {
		const pre = (
			<pre>
				<code class={`language-${language}`} safe>
					{code}
				</code>
			</pre>
		) as string;
		return chrome ? ((<CodeBlock pre={pre} language={language} />) as string) : pre;
	}
}

function getHighlighter(): Promise<Highlighter> {
	highlighterPromise ??= createHighlighter({
		langs: [
			"astro",
			"bash",
			"css",
			"diff",
			"elixir",
			"html",
			"ini",
			"javascript",
			"json",
			"json5",
			"jsonc",
			"lua",
			"markdown",
			"nu",
			"nushell",
			"odin",
			"powershell",
			"shellscript",
			"tsx",
			"typst",
			"typescript",
		],
		themes: ["ayu-light", "ayu-dark"],
	}).then((instance) => {
		highlighter = instance;
		return instance;
	});
	return highlighterPromise;
}

function CodeBlock(props: { pre: string; language: string }) {
	return (
		<div
			class="code-block my-4 overflow-hidden rounded-lg border bg-[var(--code-background)] [&_pre]:m-0! [&_pre]:rounded-none! [&_pre]:bg-[var(--code-background)]! [&_pre]:p-4! [&_pre]:text-sm! [&_pre]:leading-relaxed!"
			data-code-block
		>
			<div class="text-muted-foreground flex items-center justify-between gap-3 border-b bg-[var(--code-background)] px-3 py-1 font-mono text-xs">
				<span safe>{props.language}</span>
				<button
					class="btn h-7 w-7 p-0 leading-none"
					data-variant="ghost"
					type="button"
					data-copy-code
					aria-label="Copy code"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						width="16"
						height="16"
						viewBox="0 0 24 24"
						aria-hidden="true"
					>
						<g
							fill="none"
							stroke="currentColor"
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
						>
							<rect width="8" height="4" x="8" y="2" rx="1" ry="1" />
							<path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
						</g>
					</svg>
				</button>
			</div>
			{props.pre}
		</div>
	);
}

function codeFenceLanguage(language: string | undefined): string {
	return language?.trim().split(/\s+/)[0]?.toLowerCase() || "text";
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

function classes(value: unknown, additions: string[]): string[] {
	const current = Array.isArray(value)
		? value.filter((item): item is string => typeof item === "string")
		: typeof value === "string"
			? value.split(/\s+/).filter(Boolean)
			: [];
	return [...new Set([...current, ...additions])];
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
