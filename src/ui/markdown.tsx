import {
	DEFAULT_THEMES,
	getFiletypeFromFileName,
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
import { loadPierreLanguage, pierreLanguages, renderPierreCode } from "./diffs.ts";
import { BoundedCache, deleteStringKeysWithPrefix } from "./render-cache.ts";
import { shikiTokenStyle } from "./shiki-token-style.ts";

// Streaming entries track roughly two restored pages; final results can deduplicate
// repeated content across a much longer desktop session.
const maxStreamingEntries = 100;
const maxFinalMarkdownEntries = 500;
const maxPierreCodeBlockEntries = 500;

const streamingCache = new BoundedCache<string, { markdown: string; html: string }>(
	maxStreamingEntries,
);
const highlightedCache = new BoundedCache<string, string>(maxFinalMarkdownEntries);
const pierreCodeBlockCache = new BoundedCache<string, string>(maxPierreCodeBlockEntries);
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
						"min-w-max",
						"w-full",
						"table-auto",
						"text-sm",
					]),
				);
				ctx.wrapNode(node, {
					type: "element",
					tagName: "div",
					properties: {
						className: [
							"table-container",
							"border-border/60",
							"bg-background",
							"overflow-x-auto",
							"rounded-md",
							"border",
						],
					},
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

export type StreamingMarkdownMeasurement = {
	html: string;
	markdownParseMs: number;
	codeBlockRenderMs: number;
};

export function renderMarkdownStreaming(
	markdown: string,
	options: { cacheKey?: string } = {},
): string {
	return renderMarkdownStreamingMeasured(markdown, options).html;
}

export function renderMarkdownStreamingMeasured(
	markdown: string,
	options: { cacheKey?: string } = {},
): StreamingMarkdownMeasurement {
	const cacheKey = options.cacheKey;
	if (cacheKey) {
		const cached = streamingCache.get(cacheKey);
		if (cached?.markdown === markdown) {
			return { html: cached.html, markdownParseMs: 0, codeBlockRenderMs: 0 };
		}
	}

	const parseStartedAt = performance.now();
	const compiled = compileMarkdown(markdown);
	const markdownParseMs = performance.now() - parseStartedAt;
	const codeStartedAt = performance.now();
	const html = renderStreamingCodeBlocks(compiled, cacheKey ?? "");
	const codeBlockRenderMs = performance.now() - codeStartedAt;
	if (cacheKey) streamingCache.set(cacheKey, { markdown, html });
	return { html, markdownParseMs, codeBlockRenderMs };
}

export function releaseMarkdownStreamingState(cacheKey: string): void {
	streamingCache.delete(cacheKey);
	deleteStringKeysWithPrefix(streamingCodeBlockStates, `${cacheKey}:`);
}

export function markdownCacheStatsForTest(): {
	streamingEntries: number;
	streamingCodeBlockStates: number;
} {
	return {
		streamingEntries: streamingCache.size,
		streamingCodeBlockStates: streamingCodeBlockStates.size,
	};
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
	return await highlightCode(code, await codeFenceLanguageFinal(language), options);
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
		const language = await codeFenceLanguageFinal(rawLanguage);
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
		const style = shikiTokenStyle(token);
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
	if (lines.length > 1 && lines.at(-1) === "") lines.pop();
	return `<pre class="plain-code" tabindex="0"><code class="streaming-code">${lines
		.map(
			(line, index) =>
				`<span class="streaming-code-line-number">${index + 1}</span><span class="streaming-code-line">${line || "&nbsp;"}</span>`,
		)
		.join("")}</code></pre>`;
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
					class="btn group relative"
					data-variant="ghost"
					data-size="icon-xs"
					type="button"
					data-copy-code
					aria-label="Copy code"
				>
					<svg
						data-copy-icon
						class="transition-[opacity,scale] duration-100 ease-out group-data-[copy-state=copied]:scale-95 group-data-[copy-state=copied]:opacity-0 motion-reduce:transform-none motion-reduce:transition-opacity"
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
					<svg
						data-copied-icon
						class="absolute scale-95 opacity-0 transition-[opacity,scale] duration-100 ease-out group-data-[copy-state=copied]:scale-100 group-data-[copy-state=copied]:opacity-100 motion-reduce:transform-none motion-reduce:transition-opacity"
						xmlns="http://www.w3.org/2000/svg"
						width="24"
						height="24"
						viewBox="0 0 24 24"
						aria-hidden="true"
					>
						<path
							fill="none"
							stroke="currentColor"
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							d="m5 12 5 5L20 7"
						/>
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
const plainCodeLanguages = new Set(["plain", "plaintext", "text", "txt"]);

async function codeFenceLanguageFinal(language: string | undefined): Promise<string> {
	const normalized = normalizedCodeFenceLanguage(language);
	if (plainCodeLanguages.has(normalized)) return "text";
	await loadPierreLanguage(normalized);
	return codeFenceLanguage(normalized);
}

function codeFenceLanguage(language: string | undefined): string {
	const normalized = normalizedCodeFenceLanguage(language);
	if (plainCodeLanguages.has(normalized)) return "text";
	if (supportedCodeLanguages.has(normalized)) return normalized;

	const loaded = loadedCodeLanguage(normalized);
	if (loaded) return loaded;

	const mapped = getFiletypeFromFileName(`code.${normalized}`);
	if (supportedCodeLanguages.has(mapped)) return mapped;
	const loadedMapped = loadedCodeLanguage(mapped);
	if (loadedMapped) return loadedMapped;

	void loadPierreLanguage(normalized);
	return "text";
}

function normalizedCodeFenceLanguage(language: string | undefined): string {
	return language?.trim().split(/\s+/)[0]?.toLowerCase() || "text";
}

function loadedCodeLanguage(language: string): string | undefined {
	try {
		return getHighlighterIfLoaded()?.getLanguage(language).name;
	} catch {
		return undefined;
	}
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
