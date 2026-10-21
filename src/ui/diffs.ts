import {
	DIFFS_TAG_NAME,
	getHighlighterIfLoaded,
	preloadHighlighter,
	type SupportedLanguages,
} from "@pierre/diffs";
import { preloadFile, preloadPatchFile } from "@pierre/diffs/ssr";
import { isSupportedLanguage } from "@pierre/highlights";

import { activeCodeThemes } from "#src/pierre-theme.ts";

export async function loadPierreLanguage(language: string): Promise<boolean> {
	if (isPierreLanguageLoaded(language)) return true;
	if (!isSupportedLanguage(language)) return false;
	try {
		await preloadHighlighter({
			themes: [activeCodeThemes.dark, activeCodeThemes.light],
			langs: [],
			preferredHighlighter: "highlights",
		});
	} catch {
		return false;
	}
	return isPierreLanguageLoaded(language);
}

export function isPierreLanguageLoaded(language: string): boolean {
	if (!isSupportedLanguage(language)) return false;
	return getHighlighterIfLoaded()?.hasLoadedLanguages([language]) ?? false;
}

export async function renderPierreDiff(patch: string): Promise<string | undefined> {
	const files = await preloadPatchFile({
		patch,
		options: {
			theme: activeCodeThemes,
			themeType: "system",
			preferredHighlighter: "highlights",
			disableFileHeader: true,
			diffStyle: "unified",
			diffIndicators: "none",
			overflow: "wrap",
			hunkSeparators: "simple",
			lineHoverHighlight: "both",
		},
	});

	if (files.length === 0) return undefined;

	return files
		.map(({ prerenderedHTML }) => pierreHost("pierre-diff", prerenderedHTML))
		.join("");
}

export async function renderPierreCode(
	code: string,
	language: string,
	options: { disableLineNumbers?: boolean } = {},
): Promise<string> {
	const file = await preloadFile({
		file: {
			name: language === "text" ? "code" : `code.${language}`,
			contents: code,
			// SAFETY: callers normalize the language through Pierre before rendering.
			lang: language as SupportedLanguages,
		},
		options: {
			theme: activeCodeThemes,
			themeType: "system",
			preferredHighlighter: "highlights",
			disableFileHeader: true,
			disableLineNumbers: options.disableLineNumbers,
			overflow: "wrap",
		},
	});

	return pierreHost("pierre-code", file.prerenderedHTML);
}

function pierreHost(className: string, prerenderedHTML: string): string {
	return `<${DIFFS_TAG_NAME} class="${className}" data-pierre-diff data-ignore-morph data-init="window.piUi.messageScroll.hydratePierreDiff(el)"><template shadowrootmode="open">${prerenderedHTML}</template></${DIFFS_TAG_NAME}>`;
}
