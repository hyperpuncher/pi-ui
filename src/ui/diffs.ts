import {
	createCoreStyleElement,
	createThemeStyleElement,
	DiffHunksRenderer,
	DIFFS_TAG_NAME,
	FileRenderer,
	getHighlighterIfLoaded,
	hastToHtml,
	parsePatchFiles,
	preloadHighlighter,
	type SupportedLanguages,
	SVGSpriteSheet,
	wrapThemeCSS,
} from "@pierre/diffs";

import { activeCodeThemes } from "#src/pierre-theme.ts";

/** Loads the Highlights backend with the active themes. It bundles every language. */
export async function loadHighlighter(): Promise<boolean> {
	if (getHighlighterIfLoaded()) return true;
	try {
		await preloadHighlighter({
			themes: [activeCodeThemes.dark, activeCodeThemes.light],
			langs: [],
			preferredHighlighter: "highlights",
		});
		return true;
	} catch {
		return false;
	}
}

const sharedOptions = {
	themeType: "system",
	preferredHighlighter: "highlights",
	disableFileHeader: true,
	headerRenderMode: "default",
	overflow: "wrap",
} as const;

type RenderResult = {
	themeStyles: string;
	baseThemeType?: "light" | "dark";
};

/** Renders a patch synchronously, or returns undefined before the highlighter loads. */
export function renderPierreDiff(patch: string): string | undefined {
	const files = parsePatchFiles(patch).flatMap(({ files }) => files);
	if (files.length === 0 || !getHighlighterIfLoaded()) return undefined;
	let html = "";
	for (const diff of files) {
		const renderer = new DiffHunksRenderer({
			...sharedOptions,
			theme: activeCodeThemes,
			diffStyle: "unified",
			diffIndicators: "none",
			hunkSeparators: "simple",
		});
		const result = renderer.renderDiff(diff);
		if (!result) return undefined;
		html += pierreHost("pierre-diff", result, renderer.renderFullAST(result));
	}
	return html;
}

/** Renders code synchronously, or returns undefined before the highlighter loads. */
export function renderPierreCode(
	code: string,
	language: string,
	options: { disableLineNumbers?: boolean } = {},
): string | undefined {
	if (!getHighlighterIfLoaded()) return undefined;
	const renderer = new FileRenderer({
		...sharedOptions,
		theme: activeCodeThemes,
		disableLineNumbers: options.disableLineNumbers,
	});
	const result = renderer.renderFile({
		name: language === "text" ? "code" : `code.${language}`,
		contents: code,
		// SAFETY: callers normalize the language through Pierre before rendering.
		lang: language as SupportedLanguages,
	});
	return result && pierreHost("pierre-code", result, renderer.renderFullAST(result));
}

function pierreHost(
	className: string,
	result: RenderResult,
	code: ReturnType<FileRenderer["renderFullAST"]>,
): string {
	code.properties["data-dehydrated"] = "";
	const html = hastToHtml([
		createCoreStyleElement(),
		createThemeStyleElement(
			wrapThemeCSS(result.themeStyles, result.baseThemeType ?? "system"),
		),
		code,
	]);
	const sprite = html.includes("<use ") ? SVGSpriteSheet : "";
	return `<${DIFFS_TAG_NAME} class="${className}" data-pierre-diff data-ignore-morph data-init="window.piUi.messageScroll.hydratePierreDiff(el)"><template shadowrootmode="open">${sprite}${html}</template></${DIFFS_TAG_NAME}>`;
}
