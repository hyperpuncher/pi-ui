import {
	getHighlighterIfLoaded,
	preloadHighlighter,
	type ThemedToken,
} from "@pierre/diffs";

import { CODE_THEMES, type CodeThemeAppearance } from "../code-themes.ts";

const themeNames = CODE_THEMES.map((theme) => theme.name);
let previewsPromise: Promise<void> | undefined;

window.piUi.codeTheme = {
	loadFontPreviews(light, dark) {
		void loadFontPreviews(
			document.documentElement.classList.contains("dark") ? dark : light,
		);
	},
	loadPreviews() {
		previewsPromise ??= loadPreviews();
	},
};

async function loadFontPreviews(theme: string): Promise<void> {
	const previews = [
		...document.querySelectorAll<HTMLElement>("[data-font-code-preview]"),
	];
	const code = previews[0]?.textContent;
	if (!code) return;

	try {
		await preloadHighlighter({ langs: ["typescript"], themes: [theme] });
		const highlighter = getHighlighterIfLoaded();
		if (!highlighter) return;
		const result = highlighter.codeToTokens(code, { lang: "typescript", theme });
		for (const preview of previews) {
			renderPreview(preview, result.tokens, result.fg ?? "inherit");
		}
	} catch {
		// Keep the plain server-rendered preview when highlighting is unavailable.
	}
}

async function loadPreviews(): Promise<void> {
	setStatus("Loading theme previews…");
	try {
		await preloadHighlighter({
			langs: ["typescript"],
			themes: themeNames,
		});
		const highlighter = getHighlighterIfLoaded();
		if (!highlighter) throw new Error("Highlighter unavailable");

		const cards = document.querySelectorAll<HTMLButtonElement>("[data-theme-name]");
		for (const [index, card] of [...cards].entries()) {
			const name = card.dataset.themeName;
			const mode = themeAppearance(card.dataset.themeAppearance);
			const preview = card.querySelector<HTMLElement>(".code-theme-preview");
			if (!name || !mode || !preview) continue;
			const result = highlighter.codeToTokens(sampleCode(name, mode), {
				lang: "typescript",
				theme: name,
			});
			renderPreview(preview, result.tokens, result.fg ?? "inherit");
			if (index > 0 && index % 8 === 0) await nextFrame();
		}
		setStatus("Theme previews ready.");
	} catch {
		previewsPromise = undefined;
		setStatus("Could not load theme previews.");
	}
}

function themeAppearance(value: string | undefined): CodeThemeAppearance | undefined {
	return value === "light" || value === "dark" ? value : undefined;
}

function sampleCode(name: string, mode: CodeThemeAppearance): string {
	return `const theme = {\n  name: '${name}',\n  mode: '${mode}',\n}`;
}

function renderPreview(
	preview: HTMLElement,
	lines: ThemedToken[][],
	foreground: string,
): void {
	preview.replaceChildren();
	preview.style.color = foreground;
	preview.style.removeProperty("background-color");
	const code = document.createElement("code");
	for (const [lineIndex, line] of lines.entries()) {
		for (const token of line) {
			const span = document.createElement("span");
			span.textContent = token.content;
			if (token.color) span.style.color = token.color;
			for (const [property, value] of Object.entries(token.htmlStyle ?? {})) {
				span.style.setProperty(property, value);
			}
			code.append(span);
		}
		if (lineIndex < lines.length - 1) code.append("\n");
	}
	preview.append(code);
}

function setStatus(message: string): void {
	const status = document.getElementById("code-theme-status");
	if (status) status.textContent = message;
}

function nextFrame(): Promise<void> {
	return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
