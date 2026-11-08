import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

import {
	type DiffsStreamTokenizer,
	getFiletypeFromFileName,
	getHighlighterIfLoaded,
	type ThemedToken,
	tokensToHtml,
} from "@pierre/diffs";
import { isSupportedLanguage } from "@pierre/highlights";

import { activeCodeThemes, codeThemeKey } from "#src/pierre-theme.ts";
import { filePreviewUrl } from "#src/server/routes/endpoints.ts";
import { isPierreLanguageLoaded, loadPierreLanguage } from "#src/ui/diffs.ts";
import { Icon } from "#src/ui/icon.tsx";
import { renderMermaid } from "#src/ui/mermaid.ts";
import { BoundedCache, deleteStringKeysWithPrefix } from "#src/ui/render-cache.ts";
import { syncHtml } from "#src/ui/sync-html.ts";
import { fileUriToPath } from "#static/file-uri.js";

// Streaming entries track roughly two restored pages; final results can deduplicate
// repeated content across a much longer session.
const maxStreamingEntries = 100;
const maxFinalMarkdownEntries = 500;
const maxCodeBlockEntries = 500;
const maxFinalCacheBytes = 8 * 1024 * 1024;

type PendingMermaidBlock = { index: number; source: string };
type StreamingMarkdownState = {
	markdown: string;
	html: string;
	diagram?: PendingMermaidBlock & { html: string };
};

const streamingCache = new BoundedCache<string, StreamingMarkdownState>(
	maxStreamingEntries,
);
const stringCacheOptions = {
	maxWeight: maxFinalCacheBytes,
	// V8 strings can use one or two bytes per code unit. Use the upper bound so
	// restored sessions with large tool output cannot retain hundreds of MiB.
	weight: (key: string, value: string) => 2 * (key.length + value.length),
};
const highlightedCache = new BoundedCache<string, string>(
	maxFinalMarkdownEntries,
	stringCacheOptions,
);
const codeBlockCache = new BoundedCache<string, string>(
	maxCodeBlockEntries,
	stringCacheOptions,
);
const streamingCodeBlockStates = new Map<string, StreamingCodeBlockState>();
const incompleteLinkPattern = /^\[([^[\]\n]+)\]\([^\n)]*$/;
const codeBlockPattern =
	/<pre><code(?: class="language-([^"]*)")?>([\s\S]*?)<\/code><\/pre>/g;

type StreamingCodeBlockState = {
	language: string;
	code: string;
	tokenizer: DiffsStreamTokenizer;
	stable: ThemedToken[];
	unstable: ThemedToken[];
};

const markdownHtmlRewriter = new HTMLRewriter()
	.on("a", {
		element(element) {
			const href = element.getAttribute("href");
			const url = href ? safeUrl(href, { allowDataImage: false }) : undefined;
			if (!href || !url) {
				element.before("<span>", { html: true });
				element.after("</span>", { html: true });
				element.removeAndKeepContent();
				return;
			}
			if (url.protocol === "file:") {
				// Keep the local URI out of href so the browser cannot attempt a
				// forbidden file:// navigation when client-side handling is unavailable.
				element.setAttribute("href", "#");
				element.setAttribute("data-pi-file-link", href);
			} else {
				element.setAttribute("target", "_blank");
				element.setAttribute("rel", "noreferrer");
			}
		},
	})
	.on("img", {
		element(element) {
			const src = element.getAttribute("src");
			if (!src || !safeUrl(src, { allowDataImage: true })) {
				element.remove();
				return;
			}
			rewriteLocalImageSource(element, src);
			// Markdown images are rare next to attachments; lazy keeps them
			// from being fetched or decoded offscreen. No reserved box here:
			// dimensions are only known for attachment images.
			element.setAttribute("loading", "lazy");
			element.setAttribute("decoding", "async");
		},
	})
	.on("table", {
		element(element) {
			element.setAttribute("class", "markdown-table");
			element.before('<div class="table-container">', { html: true });
			element.after("</div>", { html: true });
		},
	})
	.on("th", {
		element(element) {
			element.setAttribute("class", "markdown-table-heading");
		},
	})
	.on("td", {
		element(element) {
			element.setAttribute("class", "markdown-table-cell");
		},
	});

export function renderMarkdownStreaming(
	markdown: string,
	options: { cacheKey?: string } = {},
): string {
	const cacheKey = options.cacheKey;
	const cached = cacheKey ? streamingCache.get(cacheKey) : undefined;
	if (cached?.markdown === markdown) {
		return cached.html;
	}
	// Restored messages can use their final HTML without starting another tokenizer.
	// Keep active streams on their existing incremental state.
	if (!cached && cacheKey) {
		const final = highlightedCache.get(finalMarkdownCacheKey(markdown, cacheKey));
		if (final !== undefined) return final;
	}

	const compiled = compileMarkdown(hideIncompleteLinkDestination(markdown));
	const pending = /class="language-mermaid(?:\s|")/i.test(compiled)
		? pendingMermaidBlock(markdown)
		: undefined;
	let diagram =
		pending &&
		cached &&
		markdown.startsWith(cached.markdown) &&
		cached.diagram?.index === pending.index
			? cached.diagram
			: undefined;
	// A header alone can produce an empty SVG; wait for another completed source line.
	if (
		pending &&
		pending.source.trim().includes("\n") &&
		pending.source !== diagram?.source
	) {
		// Keep only the latest draft in the message cache, not the completed-diagram cache.
		diagram = {
			...pending,
			html:
				renderMermaid(
					pending.source,
					cacheKey || compiled,
					pending.index,
					false,
				) ??
				diagram?.html ??
				"",
		};
	}
	const html = renderStreamingCodeBlocks(
		compiled,
		cacheKey ?? "",
		pending ? { index: pending.index, html: diagram?.html ?? "" } : undefined,
	);
	if (cacheKey) streamingCache.set(cacheKey, { markdown, html, diagram });
	return html;
}

export function releaseMarkdownStreamingState(cacheKey: string): void {
	streamingCache.delete(cacheKey);
	deleteStringKeysWithPrefix(
		streamingCodeBlockStates,
		`${codeThemeKey()}:${cacheKey}:`,
	);
}

export async function renderMarkdownFinal(
	markdown: string,
	options: { localImageBase?: string; cacheKey?: string } = {},
): Promise<string> {
	const localImageBase = options.localImageBase ?? "";
	const cacheKey = finalMarkdownCacheKey(markdown, options.cacheKey, localImageBase);
	const cached = highlightedCache.get(cacheKey);
	if (cached) return cached;
	let html = await highlightCodeBlocksFinal(
		compileMarkdown(markdown),
		options.cacheKey ?? markdown,
	);
	if (localImageBase) html = rewriteRelativeImageSources(html, localImageBase);
	highlightedCache.set(cacheKey, html);
	return html;
}

function finalMarkdownCacheKey(
	markdown: string,
	scope = "",
	localImageBase = "",
): string {
	// Only diagrams contain message-scoped SVG identifiers. Ordinary Markdown
	// can share final HTML even when a restore assigns new message identifiers.
	const diagramScope = /mermaid/i.test(markdown) ? scope : "";
	return `${codeThemeKey()}\0${localImageBase}\0${diagramScope}\0${markdown}`;
}

function hideIncompleteLinkDestination(markdown: string): string {
	const opening = markdown.lastIndexOf("](");
	if (opening < 0) return markdown;
	const labelStart = markdown.lastIndexOf("[", opening);
	if (labelStart < 0 || markdown[labelStart - 1] === "!") return markdown;
	const suffix = markdown.slice(labelStart);
	const match = incompleteLinkPattern.exec(suffix);
	return match ? markdown.slice(0, labelStart) + match[1] : markdown;
}

function compileMarkdown(markdown: string): string {
	const options = {
		noHtmlBlocks: true,
		noHtmlSpans: true,
		strikethrough: true,
		tables: true,
		tasklists: true,
	};
	let html = Bun.markdown.html(markdown, { ...options, autolinks: true });
	// Temporary workaround for https://github.com/oven-sh/bun/issues/43980.
	// Bare URLs can consume emphasis delimiters and leave formatting tags open.
	if (hasUnbalancedEmphasis(html)) {
		html = Bun.markdown.html(markdown, { ...options, autolinks: false });
	}
	return markdownHtmlRewriter.transform(html);
}

function hasUnbalancedEmphasis(html: string): boolean {
	const stack: string[] = [];
	// Raw HTML is disabled, so these tags can only come from the renderer.
	for (const [, closing, tag] of html.matchAll(/<(\/?)(strong|em|del)>/g)) {
		if (!closing) stack.push(tag);
		else if (stack.pop() !== tag) return true;
	}
	return stack.length > 0;
}

export async function renderCodeFinal(
	code: string,
	language: string,
	options: { chrome?: boolean } = {},
): Promise<string> {
	return renderPlainCode(code, await codeFenceLanguageFinal(language), options);
}

function pendingMermaidBlock(markdown: string): PendingMermaidBlock | undefined {
	const marker = `pi-ui-stream-boundary-${crypto.randomUUID()}`;
	let pending: PendingMermaidBlock | undefined;
	let index = 0;
	const trimmed = markdown.trimEnd();
	// Keep the marker in the current container without completing a closing fence at EOF.
	const prefix = markdown.endsWith("\n")
		? (/^[ \t]*(?:>[ \t]*)*/.exec(
				trimmed.slice(trimmed.lastIndexOf("\n") + 1),
			)?.[0] ?? "")
		: "";
	Bun.markdown.render(
		markdown + prefix + marker,
		{
			code: (source, meta) => {
				if (
					normalizedCodeFenceLanguage(meta?.language) === "mermaid" &&
					source.endsWith(`${marker}\n`)
				) {
					// Exclude the in-progress line, including partial closing fences.
					const boundary = source.length - marker.length - 1;
					pending = {
						index,
						source: source.slice(
							0,
							source.lastIndexOf("\n", boundary - 1) + 1,
						),
					};
				}
				index += 1;
				return "";
			},
		},
		{ noHtmlBlocks: true, noHtmlSpans: true },
	);
	return pending;
}

function renderStreamingCodeBlocks(
	html: string,
	cacheKeyPrefix = "",
	pending?: { index: number; html: string },
): string {
	let index = 0;
	return html.replace(
		codeBlockPattern,
		(_raw, rawLanguage: string | undefined, rawCode: string) => {
			const blockIndex = index++;
			if (pending?.index === blockIndex) return pending.html;
			const source = decodeHtml(rawCode).replace(/\n$/, "");
			if (!source) return "";
			if (normalizedCodeFenceLanguage(rawLanguage) === "mermaid") {
				const diagram = renderMermaid(source, cacheKeyPrefix || html, blockIndex);
				if (diagram !== undefined) return diagram;
			}
			const language = codeFenceLanguage(rawLanguage);
			const code = source.replace(/\n`{1,2}[ \t]*$/, "");
			return cacheKeyPrefix
				? highlightStreamingCodeBlock(
						code,
						language,
						`${cacheKeyPrefix}:${blockIndex}`,
					)
				: renderStreamingPlainCodeBlock(code, language);
		},
	);
}

async function highlightCodeBlocksFinal(html: string, scope: string): Promise<string> {
	const parts: string[] = [];
	let offset = 0;
	let index = 0;
	for (const block of html.matchAll(codeBlockPattern)) {
		const [raw, rawLanguage, rawCode] = block;
		const blockIndex = index++;
		parts.push(html.slice(offset, block.index));
		offset = block.index + raw.length;
		const code = decodeHtml(rawCode).replace(/\n$/, "");
		if (normalizedCodeFenceLanguage(rawLanguage) === "mermaid") {
			const diagram = renderMermaid(code, scope, blockIndex);
			if (diagram !== undefined) {
				parts.push(diagram);
				continue;
			}
		}
		const language = await codeFenceLanguageFinal(rawLanguage);
		parts.push(
			syncHtml(
				<CodeBlock
					pre={cachedCodeBlock(code, language)}
					language={language}
					source={code}
				/>,
			),
		);
	}
	parts.push(html.slice(offset));
	return parts.join("");
}

function cachedCodeBlock(code: string, language: string): string {
	const key = `${codeThemeKey()}\0${language}\0${code}`;
	const cached = codeBlockCache.get(key);
	if (cached) return cached;
	const highlighted =
		getHighlighterIfLoaded()?.codeToHtml(code, {
			lang: language,
			themes: activeCodeThemes,
			defaultColor: "light-dark()",
		}) ?? renderCodeTokensPre(code);
	codeBlockCache.set(key, highlighted);
	return highlighted;
}

function highlightStreamingCodeBlock(
	code: string,
	language: string,
	cacheKey: string,
): string {
	const highlighter = getHighlighterIfLoaded();
	if (!highlighter || !isPierreLanguageLoaded(language)) {
		if (language !== "text") void loadPierreLanguage(language);
		return renderStreamingPlainCodeBlock(code, language);
	}

	const themedCacheKey = `${codeThemeKey()}:${cacheKey}`;
	let state = streamingCodeBlockStates.get(themedCacheKey);
	if (!state || state.language !== language || !code.startsWith(state.code)) {
		state?.tokenizer.dispose();
		state = {
			language,
			code: "",
			tokenizer: highlighter.createStreamTokenizer({
				lang: language,
				themes: activeCodeThemes,
				defaultColor: "light-dark()",
			}),
			stable: [],
			unstable: [],
		};
		streamingCodeBlockStates.set(themedCacheKey, state);
	}

	const chunk = code.slice(state.code.length);
	if (chunk) {
		const result = state.tokenizer.enqueue(chunk);
		if (result instanceof Promise)
			throw new Error("Highlights stream tokenizer must be synchronous");
		state.stable.push(...result.stable);
		state.unstable = result.unstable;
		state.code = code;
	}

	return syncHtml(
		<CodeBlock
			pre={renderCodeTokensPre(code, [...state.stable, ...state.unstable])}
			language={language}
			source={code}
		/>,
	);
}

function renderCodeTokensPre(
	code: string,
	tokens: ThemedToken[] = [{ content: code, offset: 0 }],
): string {
	const lines: ThemedToken[][] = [[]];
	// The stream returns flat tokens; Pierre's HTML renderer expects source lines.
	for (const token of tokens) {
		let offset = token.offset;
		for (const [index, content] of token.content.split("\n").entries()) {
			if (index > 0) lines.push([]);
			if (content) lines[lines.length - 1]!.push({ ...token, content, offset });
			offset += content.length + 1;
		}
	}
	return tokensToHtml(
		code,
		{ tokens: lines, rootStyle: false },
		{ lang: "text", themes: activeCodeThemes, defaultColor: "light-dark()" },
		true,
	);
}

function renderStreamingPlainCodeBlock(code: string, language: string): string {
	return syncHtml(
		<CodeBlock pre={renderCodeTokensPre(code)} language={language} source={code} />,
	);
}

function renderPlainCode(
	code: string,
	language: string,
	options: { chrome?: boolean } = {},
): string {
	const pre = `<pre class="plain-code" tabindex="0"><code class="language-${Bun.escapeHTML(language)}">${Bun.escapeHTML(code)}</code></pre>`;
	return options.chrome === false
		? pre
		: syncHtml(<CodeBlock pre={pre} language={language} />);
}

function CodeBlock(props: { pre: string; language: string; source?: string }) {
	return (
		<div
			class="code-block"
			data-code-block
			data-code-source={
				props.source === undefined ? undefined : Bun.escapeHTML(props.source)
			}
		>
			<div class="code-block-header">
				<span safe>{props.language}</span>
				<button
					class="btn code-copy-button"
					data-variant="ghost"
					data-size="icon-xs"
					type="button"
					data-copy-code
					aria-label="Copy code"
				>
					<Icon name="copy" />
					<Icon name="check" />
				</button>
			</div>
			<div class="code-block-content">{props.pre}</div>
		</div>
	);
}

const codeLanguageAliases = new Map([
	["bash", "bash"],
	["sh", "shellscript"],
	["tf", "terraform"],
	["yml", "yaml"],
]);

async function codeFenceLanguageFinal(language: string | undefined): Promise<string> {
	const canonical = canonicalCodeLanguage(language);
	return (await loadPierreLanguage(canonical)) ? canonical : "text";
}

function codeFenceLanguage(language: string | undefined): string {
	const canonical = canonicalCodeLanguage(language);
	if (isPierreLanguageLoaded(canonical)) return canonical;
	if (canonical !== "text") void loadPierreLanguage(canonical);
	return "text";
}

function canonicalCodeLanguage(language: string | undefined): string {
	const normalized = normalizedCodeFenceLanguage(language);
	const alias = codeLanguageAliases.get(normalized);
	if (alias) return alias;
	const mapped = getFiletypeFromFileName(`code.${normalized}`);
	return mapped !== "text" && isSupportedLanguage(mapped) ? mapped : normalized;
}

function normalizedCodeFenceLanguage(language: string | undefined): string {
	return language?.trim().split(/\s+/)[0]?.toLowerCase() || "text";
}

const localImagePattern = /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)$/i;
const safeUrlProtocols = new Set(["http:", "https:", "mailto:", "file:"]);

function rewriteRelativeImageSources(html: string, basePath: string): string {
	return new HTMLRewriter()
		.on("img", {
			element(element) {
				const source = element.getAttribute("src");
				if (!source) return;
				const url = URL.parse(source, "http://pi-ui.local");
				if (!url || url.origin !== "http://pi-ui.local" || source.startsWith("/"))
					return;
				try {
					const relativePath = decodeURIComponent(
						source.split(/[?#]/, 1)[0] ?? "",
					);
					rewriteLocalImageSource(element, resolve(basePath, relativePath));
				} catch {
					// Leave malformed sources unchanged.
				}
			},
		})
		.transform(html);
}

// Serve local images over HTTP. Missing files must not leave a source that the
// browser will try to load, such as a temporary file removed after a reboot.
function rewriteLocalImageSource(
	element: HTMLRewriterTypes.Element,
	source: string,
): void {
	const path = source.toLowerCase().startsWith("file:")
		? fileUriToPath(source)
		: source.startsWith("~/")
			? `${homedir()}${source.slice(1)}`
			: source.startsWith("/") && !source.startsWith("//")
				? source
				: undefined;
	if (!path || !localImagePattern.test(path)) return;
	if (existsSync(path)) {
		element.setAttribute("src", filePreviewUrl(path));
	} else {
		const alt = decodeHtml(element.getAttribute("alt") ?? "");
		element.replace(alt ? `[image unavailable: ${alt}]` : "[image unavailable]");
	}
}

function safeUrl(value: string, options: { allowDataImage: boolean }): URL | undefined {
	const url = URL.parse(value, "http://pi-ui.local");
	if (!url) return undefined;
	if (url.protocol === "data:") {
		return options.allowDataImage &&
			/^data:image\/(png|jpeg|gif|webp);base64,/i.test(value)
			? url
			: undefined;
	}
	return safeUrlProtocols.has(url.protocol) ? url : undefined;
}

function decodeHtml(value: string): string {
	if (!value.includes("&")) return value;
	return value
		.replaceAll("&lt;", "<")
		.replaceAll("&gt;", ">")
		.replaceAll("&quot;", '"')
		.replaceAll("&#39;", "'")
		.replaceAll("&#x27;", "'")
		.replaceAll("&amp;", "&");
}
