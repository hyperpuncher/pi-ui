import {
	getHighlighterIfLoaded,
	preloadHighlighter,
	resolveTheme,
	type ThemedToken,
} from "@pierre/diffs";

import { CODE_THEMES, type CodeThemeAppearance } from "../code-themes.ts";
import {
	DEFAULT_PIERRE_THEMES,
	isPierreThemes,
	type PierreThemes,
} from "../pierre-theme.ts";

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

const initialLightTheme = document.body.dataset.codeThemeLight;
const initialDarkTheme = document.body.dataset.codeThemeDark;
if (initialLightTheme && initialDarkTheme) {
	setTimeout(() => {
		void syncStatusColors({ dark: initialDarkTheme, light: initialLightTheme });
	});
}
window.addEventListener("pi-ui-code-theme-changed", (event) => {
	if (event instanceof CustomEvent && isPierreThemes(event.detail)) {
		void syncStatusColors(event.detail);
	}
});
window.addEventListener("pi-ui-theme-mode-changed", applyStatusColors);

type StatusColors = Readonly<{ error?: string; success?: string; warning?: string }>;

let statusColorGeneration = 0;
let statusThemeKey = "";
let statusColors: Readonly<{ dark: StatusColors; light: StatusColors }> | undefined;
const statusColorLoads = new Map<string, Promise<StatusColors>>();

async function syncStatusColors(themes: PierreThemes): Promise<void> {
	const themeKey = `${themes.light}:${themes.dark}`;
	if (themeKey === statusThemeKey) return;
	statusThemeKey = themeKey;
	const generation = ++statusColorGeneration;
	const [light, dark, fallbackLight, fallbackDark] = await Promise.all([
		loadStatusColors(themes.light),
		loadStatusColors(themes.dark),
		loadStatusColors(DEFAULT_PIERRE_THEMES.light),
		loadStatusColors(DEFAULT_PIERRE_THEMES.dark),
	]);
	if (generation !== statusColorGeneration) return;
	statusColors = {
		light: {
			error: light.error ?? fallbackLight.error,
			warning: light.warning ?? fallbackLight.warning,
			success: light.success ?? fallbackLight.success,
		},
		dark: {
			error: dark.error ?? fallbackDark.error,
			warning: dark.warning ?? fallbackDark.warning,
			success: dark.success ?? fallbackDark.success,
		},
	};
	applyStatusColors();
}

function loadStatusColors(themeName: string): Promise<StatusColors> {
	const cached = statusColorLoads.get(themeName);
	if (cached) return cached;
	const loading = resolveTheme(themeName)
		.then((theme) => ({
			error:
				theme.colors?.["gitDecoration.deletedResourceForeground"] ??
				theme.colors?.["terminal.ansiRed"],
			warning:
				theme.colors?.["editorWarning.foreground"] ??
				theme.colors?.["terminal.ansiYellow"],
			success:
				theme.colors?.["gitDecoration.addedResourceForeground"] ??
				theme.colors?.["terminal.ansiGreen"],
		}))
		.catch(() => ({}));
	statusColorLoads.set(themeName, loading);
	return loading;
}

function applyStatusColors(): void {
	if (!statusColors) return;
	const mode = document.documentElement.classList.contains("dark") ? "dark" : "light";
	for (const [name, value] of Object.entries(statusColors[mode])) {
		const property = `--status-${name}`;
		if (value) document.documentElement.style.setProperty(property, value);
		else document.documentElement.style.removeProperty(property);
	}
}

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
