import {
	DIFFS_TAG_NAME,
	getHighlighterIfLoaded,
	preloadHighlighter,
	type SupportedLanguages,
} from "@pierre/diffs";
import { preloadFile, preloadPatchFile } from "@pierre/diffs/ssr";

import { getPierreThemes } from "../pierre-theme.ts";

const pierreUnsafeCSS = `
	::selection {
		background: var(--selection);
		color: currentColor;
	}

	[data-additions-count] {
		order: 1;
	}

	[data-deletions-count] {
		order: 2;
	}

	[data-metadata] slot {
		order: 3;
	}

	[data-code] {
		align-self: stretch;
		background: var(--diffs-bg);
		overflow: auto clip;
		width: 100%;
	}

	[data-diff],
	[data-file] {
		width: 100%;
	}
`;

export const pierreLanguages = [
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
	"typescript",
	"typst",
] as const satisfies SupportedLanguages[];

// Bound request metadata only; Shiki retains successfully loaded grammars itself.
const languageLoads = new Map<string, Promise<boolean>>();
const maxLanguageLoadEntries = 256;

export async function preloadPierreHighlighter(): Promise<void> {
	const themes = getPierreThemes();
	await preloadHighlighter({
		themes: [themes.dark, themes.light],
		langs: [...pierreLanguages],
	});
}

export function loadPierreLanguage(language: string): Promise<boolean> {
	if (isPierreLanguageLoaded(language)) return Promise.resolve(true);

	const cached = languageLoads.get(language);
	if (cached) return cached;

	const themes = getPierreThemes();
	const loading = preloadHighlighter({
		themes: [themes.dark, themes.light],
		langs: [language],
	})
		.then(() => isPierreLanguageLoaded(language))
		.catch(() => false);
	languageLoads.set(language, loading);
	if (languageLoads.size > maxLanguageLoadEntries) {
		languageLoads.delete(languageLoads.keys().next().value ?? "");
	}
	return loading;
}

function isPierreLanguageLoaded(language: string): boolean {
	const highlighter = getHighlighterIfLoaded();
	if (!highlighter) return false;
	try {
		highlighter.getLanguage(language);
		return true;
	} catch {
		return false;
	}
}

export async function renderPierreDiff(patch: string): Promise<string | undefined> {
	const files = await preloadPatchFile({
		patch,
		options: {
			theme: getPierreThemes(),
			themeType: "system",
			disableFileHeader: true,
			diffStyle: "unified",
			diffIndicators: "none",
			overflow: "wrap",
			hunkSeparators: "simple",
			lineHoverHighlight: "both",
			unsafeCSS: pierreUnsafeCSS,
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
			// SAFETY: callers normalize the language through Pierre or Shiki before rendering.
			lang: language as SupportedLanguages,
		},
		options: {
			theme: getPierreThemes(),
			themeType: "system",
			disableFileHeader: true,
			disableLineNumbers: options.disableLineNumbers,
			overflow: "wrap",
			unsafeCSS: pierreUnsafeCSS,
		},
	});

	return pierreHost("pierre-code", file.prerenderedHTML);
}

function pierreHost(className: string, prerenderedHTML: string): string {
	return `<${DIFFS_TAG_NAME} class="${className}" data-pierre-diff data-init="window.piUi.messageScroll.hydratePierreDiff(el)"><template shadowrootmode="open">${prerenderedHTML}</template></${DIFFS_TAG_NAME}>`;
}
