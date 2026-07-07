import {
	DEFAULT_THEMES,
	getHighlighterIfLoaded,
	ShikiStreamTokenizer,
	type SupportedLanguages,
	type ThemedToken,
} from "@pierre/diffs";
import {
	defineHastPlugin,
	defineMdastPlugin,
	markdownToHtml,
	type CompileOptions,
} from "satteri";

import { escapeHtml } from "../utils/html.ts";
import { pierreLanguages, renderPierreCode } from "./diffs.ts";

const streamingCache = new Map<string, string>();
const highlightedCache = new Map<string, string>();
const pierreCodeBlockCache = new Map<string, string>();
const streamingCodeBlockStates = new Map<string, StreamingCodeBlockState>();

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

export function renderMarkdownStreaming(
	markdown: string,
	options: { cacheKey?: string } = {},
): string {
	const cacheKey = `${options.cacheKey ?? ""}\0${markdown}`;
	const cached = streamingCache.get(cacheKey);
	if (cached) {
		return cached;
	}
	const html = renderStreamingCodeBlocks(
		compileMarkdown(markdown),
		options.cacheKey ?? "",
	);
	streamingCache.set(cacheKey, html);
	return html;
}

export async function renderMarkdownFinal(markdown: string): Promise<string> {
	const cached = highlightedCache.get(markdown);
	if (cached) {
		return cached;
	}
	const html = await highlightCodeBlocksFinal(compileMarkdown(markdown));
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

function renderStreamingCodeBlocks(html: string, cacheKeyPrefix = ""): string {
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
		const replacement = cacheKeyPrefix
			? highlightStreamingCodeBlock(code, language, `${cacheKeyPrefix}:${index}`)
			: renderPlainCodeBlock(code, language);
		highlighted = highlighted.replace(raw, replacement);
	}
	return highlighted;
}

async function highlightCode(
	code: string,
	language: string,
	options: { chrome?: boolean } = {},
): Promise<string> {
	return renderPlainCode(code, language, options);
}

async function highlightCodeBlocksFinal(html: string): Promise<string> {
	const blocks = [
		...html.matchAll(
			/<pre><code class="language-([^"]*)">([\s\S]*?)<\/code><\/pre>/g,
		),
	];
	if (blocks.length === 0) return html;

	let highlighted = html;
	for (const block of blocks) {
		const [raw, rawLanguage, rawCode] = block;
		const language = codeFenceLanguage(rawLanguage);
		const code = decodeHtml(rawCode);
		const replacement = (
			<CodeBlock
				pre={await cachedPierreCodeBlock(code, language)}
				language={language}
				source={code}
			/>
		) as string;
		highlighted = highlighted.replace(raw, replacement);
	}
	return highlighted;
}

async function cachedPierreCodeBlock(code: string, language: string): Promise<string> {
	const key = `${language}\0${code}`;
	const cached = pierreCodeBlockCache.get(key);
	if (cached) return cached;
	const highlighted = await renderPierreCode(code, language);
	pierreCodeBlockCache.set(key, highlighted);
	return highlighted;
}

function highlightStreamingCodeBlock(
	code: string,
	language: string,
	cacheKey: string,
): string {
	const highlighter = getHighlighterIfLoaded();
	if (!highlighter) return renderPlainCodeBlock(code, language);

	let state = streamingCodeBlockStates.get(cacheKey);
	if (!state || state.language !== language || !code.startsWith(state.code)) {
		state = {
			language,
			code: "",
			tokenizer: new ShikiStreamTokenizer({
				highlighter,
				lang: language as SupportedLanguages,
				themes: DEFAULT_THEMES,
			}),
		};
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
			source={code}
		/>
	) as string;
}

function renderStreamingTokensPre(tokens: ThemedToken[]): string {
	const lines = [""];
	for (const token of tokens) {
		const style = styleObjectToAttribute(token.htmlStyle ?? tokenStyle(token));
		const styleAttribute = style ? ` style="${escapeHtml(style)}"` : "";
		const classAttribute = style ? ` class="streaming-token"` : "";
		const parts = token.content.split("\n");
		for (const [index, part] of parts.entries()) {
			if (part) {
				lines[lines.length - 1] +=
					`<span${classAttribute}${styleAttribute}>${escapeHtml(part)}</span>`;
			}
			if (index < parts.length - 1) lines.push("");
		}
	}
	return `<pre class="plain-code" tabindex="0"><code class="streaming-code">${lines
		.map(
			(line, index) =>
				`<span class="streaming-code-line-number">${index + 1}</span><span class="streaming-code-line">${line || "&nbsp;"}</span>`,
		)
		.join("")}</code></pre>`;
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

function renderPlainCodeBlock(code: string, language: string): string {
	return (
		<CodeBlock
			pre={renderPlainCode(code, language, { chrome: false })}
			language={language}
			source={code}
		/>
	) as string;
}

function renderPlainCode(
	code: string,
	language: string,
	options: { chrome?: boolean } = {},
): string {
	const pre = `<pre class="plain-code" tabindex="0"><code class="language-${escapeHtml(language)}">${escapeHtml(code)}</code></pre>`;
	return options.chrome === false
		? pre
		: ((<CodeBlock pre={pre} language={language} />) as string);
}

function CodeBlock(props: { pre: string; language: string; source?: string }) {
	return (
		<div
			class="code-block [&_pre]:tab-size-4! bg-muted/40 dark:bg-muted/55 border-border/60 my-4 overflow-hidden rounded-md border [&_pre]:m-0! [&_pre]:rounded-none! [&_pre]:bg-[var(--code-background)]! [&_pre]:p-4! [&_pre]:text-[13px]! [&_pre]:leading-[22px]!"
			data-code-block
		>
			{props.source !== undefined && (
				<script type="text/plain" data-code-source safe>
					{props.source}
				</script>
			)}
			<div class="text-muted-foreground flex items-center justify-between gap-3 px-3 py-0.5 font-mono text-xs">
				<span safe>{props.language}</span>
				<button
					class="btn"
					data-variant="ghost"
					data-size="icon-xs"
					type="button"
					data-copy-code
					aria-label="Copy code"
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						width="24"
						height="24"
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
			<div class="border-border/60 overflow-hidden rounded-t-md border-t bg-[var(--code-background)]">
				{props.pre}
			</div>
		</div>
	);
}

const supportedCodeLanguages = new Set<string>([...pierreLanguages, "text"]);

function codeFenceLanguage(language: string | undefined): string {
	const normalized = language?.trim().split(/\s+/)[0]?.toLowerCase() || "text";
	if (["plain", "plaintext", "txt"].includes(normalized)) return "text";
	return supportedCodeLanguages.has(normalized) ? normalized : "text";
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
