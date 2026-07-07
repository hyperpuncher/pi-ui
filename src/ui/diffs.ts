import {
	DEFAULT_THEMES,
	DIFFS_TAG_NAME,
	preloadHighlighter,
	type SupportedLanguages,
} from "@pierre/diffs";
import { preloadFile, preloadPatchFile } from "@pierre/diffs/ssr";

const pierreUnsafeCSS = `
	[data-code] {
		align-self: stretch;
		background: var(--diffs-bg);
		overflow: auto clip;
		scrollbar-gutter: auto;
		width: 100%;
	}

	[data-code]::-webkit-scrollbar-track,
	[data-code]::-webkit-scrollbar-corner {
		background: var(--diffs-bg);
	}

	[data-code]::-webkit-scrollbar-thumb {
		background-color: color-mix(in oklab, var(--muted-foreground) 45%, transparent);
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

export async function preloadPierreHighlighter(): Promise<void> {
	await preloadHighlighter({
		themes: [DEFAULT_THEMES.dark, DEFAULT_THEMES.light],
		langs: [...pierreLanguages],
	});
}

const hostStyle = [
	"--diffs-font-family: var(--font-mono)",
	"--diffs-header-font-family: var(--font-sans)",
	"--diffs-font-features: normal",
	"--diffs-font-size: 13px",
	"--diffs-line-height: 22px",
	"--diffs-tab-size: 4",
	"--diffs-gap-block: 0px",
	"--diffs-gap-inline: 0px",
	"--diffs-light-bg: color-mix(in oklab, var(--muted) 40%, transparent)",
	"--diffs-dark-bg: color-mix(in oklab, var(--muted) 55%, transparent)",
	"--diffs-bg-buffer-override: transparent",
	"--diffs-bg-context-override: transparent",
	"--diffs-bg-context-gutter-override: transparent",
].join("; ");

export async function renderPierreDiff(patch: string): Promise<string | undefined> {
	const files = await preloadPatchFile({
		patch,
		options: {
			theme: DEFAULT_THEMES,
			themeType: "system",
			disableFileHeader: true,
			diffStyle: "unified",
			diffIndicators: "bars",
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

export async function renderPierreCode(code: string, language: string): Promise<string> {
	const file = await preloadFile({
		file: {
			name: language === "text" ? "code" : `code.${language}`,
			contents: code,
			lang: language as SupportedLanguages,
		},
		options: {
			theme: DEFAULT_THEMES,
			themeType: "system",
			disableFileHeader: true,
			overflow: "wrap",
			unsafeCSS: pierreUnsafeCSS,
		},
	});

	return pierreHost("pierre-code", file.prerenderedHTML);
}

function pierreHost(className: string, prerenderedHTML: string): string {
	return `<${DIFFS_TAG_NAME} class="${className}" data-pierre-diff style="display:block; width:100%; ${hostStyle}"><template shadowrootmode="open">${prerenderedHTML}</template></${DIFFS_TAG_NAME}>`;
}
