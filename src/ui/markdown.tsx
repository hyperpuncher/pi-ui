import { existsSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

import { createHighlightsPlugin } from "@pierre/words/highlights";
import {
	type CodeHighlighterPlugin,
	type CodeOptions,
	createHtmlRenderer,
	escapeHtml,
	type HtmlOptions,
} from "@pierre/words/html";

import { codeThemeObject } from "#src/code-themes.ts";
import { activeCodeThemes, codeThemeKey } from "#src/pierre-theme.ts";
import { filePreviewUrl } from "#src/server/routes/endpoints.ts";
import { Icon } from "#src/ui/icon.tsx";
import { renderMermaid } from "#src/ui/mermaid.ts";
import { BoundedCache } from "#src/ui/render-cache.ts";
import { syncHtml } from "#src/ui/sync-html.ts";
import { fileUriToPath } from "#static/file-uri.js";

// Streaming entries track roughly two restored pages; final results deduplicate
// repeated content across a much longer session.
const maxStreamingEntries = 100;
const maxFinalMarkdownEntries = 500;
const maxFinalCacheBytes = 8 * 1024 * 1024;
const liveTokenizerThreshold = 1024;

const fileLinkPrefix = "/__pi_file__/";
const dataImagePrefix = "/__pi_data_img__/";
const missingImageSentinel = "/__pi_missing_img__";
const localImagePattern = /\.(?:avif|bmp|gif|jpe?g|png|svg|webp)$/i;
const dataImagePattern = /^data:image\/(?:png|jpeg|gif|webp);base64,/i;
const customUrlPattern = /file:|!\[/i;
const mermaidPattern = /mermaid/i;
const baseCodeOptions = {
	controls: { code: { copy: true, download: false } },
	lineNumbers: true,
} as const;

type WordsHtmlRenderer = ReturnType<typeof createHtmlRenderer>;

type RendererFeatures = {
	fencedCode: boolean;
	customUrls: boolean;
	mermaid: boolean;
};

type StreamingMarkdownState = {
	renderer: WordsHtmlRenderer;
	themeKey: string;
	features: RendererFeatures;
	markdown: string;
	stableHtml: string;
	html: string;
};

const streamingCache = new BoundedCache<string, StreamingMarkdownState>(
	maxStreamingEntries,
	{
		onEvict: (_key, state) => {
			state.renderer.dispose();
		},
	},
);

type FinalCacheEntry = {
	markdown: string;
	html: string;
};

const finalCache = new BoundedCache<string, FinalCacheEntry>(maxFinalMarkdownEntries, {
	maxWeight: maxFinalCacheBytes,
	// V8/JSC strings can use up to two bytes per code unit. Use the upper bound
	// so restored sessions with large output cannot retain hundreds of MiB.
	weight: (_key, entry) => 2 * (entry.markdown.length + entry.html.length),
});

let cachedPluginKey = "";
let cachedCodePlugin: CodeHighlighterPlugin | undefined;
let plainFinalRenderer: WordsHtmlRenderer | undefined;
let codeFinalRendererKey = "";
let codeFinalRenderer: WordsHtmlRenderer | undefined;

function getCodePlugin(): CodeHighlighterPlugin | undefined {
	const key = codeThemeKey();
	if (key === cachedPluginKey && cachedCodePlugin) return cachedCodePlugin;
	const light = codeThemeObject(activeCodeThemes.light);
	const dark = codeThemeObject(activeCodeThemes.dark);
	if (!light || !dark) return undefined;
	cachedPluginKey = key;
	const base = createHighlightsPlugin({
		themes: { light, dark },
		defaultColor: "light-dark()",
	});
	// LiveTokenizer has ~0.37ms setup cost; use one-shot highlight until a fence grows.
	cachedCodePlugin = {
		highlight: base.highlight,
		createSession() {
			let live: ReturnType<NonNullable<typeof base.createSession>> | undefined;
			return {
				highlight(options: CodeOptions) {
					if (!live && options.code.length < liveTokenizerThreshold) {
						return base.highlight(options);
					}
					live ??= base.createSession?.();
					return live ? live.highlight(options) : base.highlight(options);
				},
				dispose() {
					live?.dispose();
					live = undefined;
				},
			};
		},
	};
	return cachedCodePlugin;
}

function getSharedFinalRenderer(fencedCode: boolean): WordsHtmlRenderer {
	if (!fencedCode) {
		plainFinalRenderer ??= createHtmlRenderer(baseCodeOptions);
		return plainFinalRenderer;
	}
	const key = codeThemeKey();
	if (key === codeFinalRendererKey && codeFinalRenderer) return codeFinalRenderer;
	codeFinalRenderer?.dispose();
	codeFinalRendererKey = key;
	codeFinalRenderer = createHtmlRenderer({
		...baseCodeOptions,
		plugins: { code: getCodePlugin() },
	});
	return codeFinalRenderer;
}

function detectFeatures(markdown: string, localImageBase = ""): RendererFeatures {
	const fencedCode = markdown.includes("```") || markdown.includes("~~~");
	const customUrls =
		customUrlPattern.test(markdown) ||
		(localImageBase !== "" && markdown.includes("!["));
	const mermaid = fencedCode && mermaidPattern.test(markdown);
	return { fencedCode, customUrls, mermaid };
}

function featuresMatch(a: RendererFeatures, b: RendererFeatures): boolean {
	return (
		a.fencedCode === b.fencedCode &&
		a.customUrls === b.customUrls &&
		a.mermaid === b.mermaid
	);
}

function applyStreamingUpdate(
	state: StreamingMarkdownState,
	markdown: string,
	incomplete: boolean,
	active: boolean,
): string {
	const update = state.renderer.render(markdown, incomplete, active);
	if (update.reset) {
		state.stableHtml = postProcessHtml(update.stable);
	} else if (update.addition) {
		state.stableHtml += postProcessHtml(update.addition);
	}
	state.html = dedupeMermaidIds(state.stableHtml + postProcessHtml(update.pending));
	state.markdown = markdown;
	return state.html;
}

export function renderMarkdownStreaming(
	markdown: string,
	options: { cacheKey?: string } = {},
): string {
	const cacheKey = options.cacheKey;
	const themeKey = codeThemeKey();
	const cached = cacheKey ? streamingCache.get(cacheKey) : undefined;
	if (cached?.markdown === markdown && cached.themeKey === themeKey) {
		return cached.html;
	}
	// Restored messages can reuse their final HTML without starting a session.
	if (!cached && cacheKey) {
		const final = getCachedFinal(markdown, cacheKey);
		if (final !== undefined) return final;
	}

	const features = detectFeatures(markdown);
	if (!cacheKey) {
		const renderer = createRenderer(markdown, "", features);
		try {
			const update = renderer.render(markdown, true, true);
			return dedupeMermaidIds(postProcessHtml(update.html));
		} finally {
			renderer.dispose();
		}
	}

	let state = cached;
	if (
		!state ||
		state.themeKey !== themeKey ||
		!featuresMatch(state.features, features)
	) {
		state?.renderer.dispose();
		state = {
			renderer: createRenderer(cacheKey, "", features),
			themeKey,
			features,
			markdown: "",
			stableHtml: "",
			html: "",
		};
		streamingCache.set(cacheKey, state);
	}

	return applyStreamingUpdate(state, markdown, true, true);
}

export function releaseMarkdownStreamingState(cacheKey: string): void {
	const state = streamingCache.get(cacheKey);
	if (!state) return;
	state.renderer.dispose();
	streamingCache.delete(cacheKey);
}

export function renderMarkdownFinal(
	markdown: string,
	options: { localImageBase?: string; cacheKey?: string } = {},
): string {
	const localImageBase = options.localImageBase ?? "";
	const scope = options.cacheKey ?? markdown;
	const cacheKey = finalMarkdownCacheKey(markdown, options.cacheKey, localImageBase);
	const cached = getCachedFinal(markdown, options.cacheKey, localImageBase, cacheKey);
	if (cached !== undefined) {
		if (options.cacheKey) releaseMarkdownStreamingState(options.cacheKey);
		return cached;
	}

	const features = detectFeatures(markdown, localImageBase);
	// Reuse the live streaming renderer when finalizing a streamed message so
	// completed blocks and highlighted fences are not parsed twice.
	const streaming =
		options.cacheKey && !localImageBase
			? streamingCache.get(options.cacheKey)
			: undefined;
	if (
		streaming &&
		streaming.themeKey === codeThemeKey() &&
		featuresMatch(streaming.features, features)
	) {
		try {
			const html = applyStreamingUpdate(streaming, markdown, false, false);
			finalCache.set(cacheKey, { markdown, html });
			return html;
		} finally {
			releaseMarkdownStreamingState(options.cacheKey!);
		}
	}
	if (options.cacheKey) releaseMarkdownStreamingState(options.cacheKey);

	// Common messages without custom URLs or Mermaid reuse a shared renderer.
	if (!features.customUrls && !features.mermaid) {
		const renderer = getSharedFinalRenderer(features.fencedCode);
		const html = postProcessHtml(renderer.render(markdown, false, false).html);
		finalCache.set(cacheKey, { markdown, html });
		return html;
	}

	const renderer = createRenderer(scope, localImageBase, features);
	try {
		const update = renderer.render(markdown, false, false);
		const html = dedupeMermaidIds(postProcessHtml(update.html));
		finalCache.set(cacheKey, { markdown, html });
		return html;
	} finally {
		renderer.dispose();
	}
}

export function renderCodeFinal(
	code: string,
	language: string,
	options: { chrome?: boolean } = {},
): string {
	const normalized = language.trim().split(/\s+/)[0]?.toLowerCase() || "text";
	const pre = `<pre class="plain-code" tabindex="0"><code class="language-${Bun.escapeHTML(normalized)}">${Bun.escapeHTML(code)}</code></pre>`;
	return options.chrome === false
		? pre
		: `<div data-markdown="code-block" data-language="${Bun.escapeHTML(normalized)}">${pre}</div>`;
}

function finalMarkdownCacheKey(
	markdown: string,
	scope = "",
	localImageBase = "",
): string {
	// Only diagrams contain message-scoped SVG identifiers. Ordinary Markdown
	// can share final HTML even when a restore assigns new message identifiers.
	const diagramScope = mermaidPattern.test(markdown) ? scope : "";
	return `${codeThemeKey()}\0${localImageBase}\0${diagramScope}\0${markdown.length}\0${Bun.hash(markdown)}`;
}

function getCachedFinal(
	markdown: string,
	scope = "",
	localImageBase = "",
	key = finalMarkdownCacheKey(markdown, scope, localImageBase),
): string | undefined {
	const entry = finalCache.get(key);
	return entry?.markdown === markdown ? entry.html : undefined;
}

function createRenderer(
	scope: string,
	localImageBase: string,
	features: RendererFeatures,
): WordsHtmlRenderer {
	const options: HtmlOptions = { ...baseCodeOptions };
	if (features.customUrls) {
		options.urlTransform = createUrlTransform(localImageBase);
	}
	if (features.fencedCode) {
		const code = getCodePlugin();
		options.plugins = features.mermaid
			? { code, renderers: [createMermaidRenderer(scope)] }
			: { code };
	}
	return createHtmlRenderer(options);
}

function createMermaidRenderer(scope: string) {
	let draft: { source: string; html: string } | undefined;
	let blockIndex = 0;
	return {
		language: "mermaid",
		frame: false,
		render({ code, isIncomplete }: CodeOptions): string | null {
			if (!isIncomplete) {
				const rendered = renderMermaid(code, scope, blockIndex);
				draft = undefined;
				if (rendered !== undefined) blockIndex += 1;
				return rendered ?? null;
			}
			// Render only completed lines while streaming; keep the last valid SVG.
			const complete = code.slice(0, code.lastIndexOf("\n") + 1);
			if (!complete.trim().includes("\n")) {
				draft = undefined;
				return "";
			}
			if (draft && complete === draft.source) return draft.html;
			const previousHtml =
				draft && complete.startsWith(draft.source) ? draft.html : "";
			const rendered = renderMermaid(complete, scope, blockIndex, false);
			const html = rendered ?? previousHtml;
			draft = { source: complete, html };
			return html;
		},
	};
}

function createUrlTransform(localImageBase: string) {
	return (url: string, key: "href" | "src"): string | null => {
		if (key === "href") {
			if (url.toLowerCase().startsWith("file:")) {
				return `${fileLinkPrefix}${encodeURIComponent(url)}`;
			}
			return url;
		}
		if (dataImagePattern.test(url)) {
			return `${dataImagePrefix}${encodeURIComponent(url)}`;
		}
		const localPath = resolveLocalImagePath(url, localImageBase);
		if (localPath && localImagePattern.test(localPath)) {
			return existsSync(localPath)
				? filePreviewUrl(localPath)
				: missingImageSentinel;
		}
		return url;
	};
}

function resolveLocalImagePath(
	source: string,
	localImageBase: string,
): string | undefined {
	if (source.toLowerCase().startsWith("file:")) return fileUriToPath(source);
	if (source.startsWith("~/")) return `${homedir()}${source.slice(1)}`;
	if (source.startsWith("/") && !source.startsWith("//")) return source;
	if (!localImageBase || source.startsWith("//")) return undefined;
	const url = URL.parse(source, "http://pi-ui.local");
	if (!url || url.origin !== "http://pi-ui.local") return undefined;
	try {
		const relativePath = decodeURIComponent(source.split(/[?#]/, 1)[0] ?? "");
		return resolve(localImageBase, relativePath);
	} catch {
		return undefined;
	}
}

function renderCopyButton(disabled: boolean): string {
	return syncHtml(
		<button
			class="btn code-copy-button"
			data-variant="ghost"
			data-size="icon-xs"
			type="button"
			data-copy-code
			disabled={disabled}
			aria-label="Copy code"
		>
			<Icon name="copy" />
			<Icon name="check" />
		</button>,
	);
}

const copyButtonHtml = renderCopyButton(false);
const copyButtonDisabledHtml = renderCopyButton(true);

function postProcessHtml(html: string): string {
	if (
		!html.includes("<a ") &&
		!html.includes("<img ") &&
		!html.includes("<table ") &&
		!html.includes('data-code-action="copy"')
	) {
		return html;
	}
	let result = html;
	if (result.includes('data-code-action="copy"')) {
		result = result
			.replaceAll(
				'<span><button type="button" data-code-action="copy" aria-label="Copy code">Copy</button></span>',
				copyButtonHtml,
			)
			.replaceAll(
				'<span><button type="button" data-code-action="copy" aria-label="Copy code" disabled="">Copy</button></span>',
				copyButtonDisabledHtml,
			);
	}
	if (result.includes("<a ")) {
		result = result.replace(
			/<a data-markdown="a" href="([^"]*)">/g,
			(_match, href: string) => {
				if (href.startsWith(fileLinkPrefix)) {
					const uri = decodeURIComponent(href.slice(fileLinkPrefix.length));
					return `<a data-markdown="a" href="#" data-pi-file-link="${escapeHtml(uri)}">`;
				}
				if (href.startsWith("#")) {
					return `<a data-markdown="a" href="${href}">`;
				}
				return `<a data-markdown="a" href="${href}" target="_blank" rel="noreferrer">`;
			},
		);
	}
	if (result.includes("<img ")) {
		result = result.replace(
			/<img data-markdown="img" src="([^"]*)" alt="([^"]*)"([^>]*)>/g,
			(_match, src: string, alt: string, rest: string) => {
				if (src === missingImageSentinel) {
					return alt ? `[image unavailable: ${alt}]` : "[image unavailable]";
				}
				const resolvedSrc = src.startsWith(dataImagePrefix)
					? escapeHtml(decodeURIComponent(src.slice(dataImagePrefix.length)))
					: src;
				return `<img data-markdown="img" src="${resolvedSrc}" alt="${alt}"${rest} decoding="async">`;
			},
		);
	}
	if (result.includes("<table ")) {
		result = result
			.replaceAll(
				'<table data-markdown="table">',
				'<div class="table-container"><table data-markdown="table">',
			)
			.replaceAll("</table>", "</table></div>");
	}
	return result;
}

/** Ensures identical Mermaid blocks within one message never share SVG IDs. */
function dedupeMermaidIds(html: string): string {
	const first = html.indexOf('class="mermaid-diagram"');
	if (first === -1 || html.indexOf('class="mermaid-diagram"', first + 1) === -1) {
		return html;
	}
	const seen = new Map<string, number>();
	return html.replace(
		/<div class="mermaid-diagram"[\s\S]*?<\/svg><\/div>/g,
		(block) => {
			const match = /aria-labelledby="(mermaid-[0-9a-f]+-\d+)-/.exec(block);
			if (!match) return block;
			const prefix = match[1]!;
			const count = seen.get(prefix) ?? 0;
			seen.set(prefix, count + 1);
			if (count === 0) return block;
			return block.replaceAll(`${prefix}-`, `${prefix}-${count}-`);
		},
	);
}
