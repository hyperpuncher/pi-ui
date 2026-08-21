import {
	getHighlighterIfLoaded,
	preloadHighlighter,
	type ThemedToken,
} from "@pierre/diffs";

import { CODE_THEMES, codeThemesFor, type CodeThemeAppearance } from "../code-themes.ts";
import { isPierreThemes } from "../pierre-theme.ts";

const themeNames = CODE_THEMES.map((theme) => theme.name);
let previewsPromise: Promise<void> | undefined;
let saving = false;
let appearance: CodeThemeAppearance = "light";

window.addEventListener("pi-ui-open-code-theme", open);
window.addEventListener("DOMContentLoaded", bind);
window.piUi.codeTheme = {
	apply: applyThemeSelection,
	begin: beginThemeSelection,
	fail: failThemeSelection,
};

function bind(): void {
	const dialog = themeDialog();
	const gallery = document.getElementById("code-theme-gallery");
	const search = document.getElementById("code-theme-search");
	if (
		!dialog ||
		!(gallery instanceof HTMLElement) ||
		!(search instanceof HTMLInputElement)
	)
		return;

	search.addEventListener("input", () => filterCards(gallery, search.value));
	for (const button of dialog.querySelectorAll<HTMLButtonElement>(
		"[data-code-theme-mode]",
	)) {
		button.addEventListener("click", () => {
			setAppearance(
				gallery,
				search,
				button.dataset.codeThemeMode === "dark" ? "dark" : "light",
			);
		});
	}
}

function open(): void {
	const dialog = themeDialog();
	if (!dialog) return;
	if (!dialog.open) dialog.showModal();
	const gallery = document.getElementById("code-theme-gallery");
	const search = document.getElementById("code-theme-search");
	if (gallery instanceof HTMLElement && search instanceof HTMLInputElement) {
		appearance = document.documentElement.classList.contains("dark")
			? "dark"
			: "light";
		search.value = "";
		setAppearance(gallery, search, appearance);
		requestAnimationFrame(() => search.focus({ preventScroll: true }));
	}
	previewsPromise ??= loadPreviews();
}

function setAppearance(
	gallery: HTMLElement,
	search: HTMLInputElement,
	next: CodeThemeAppearance,
): void {
	appearance = next;
	for (const button of document.querySelectorAll<HTMLButtonElement>(
		"[data-code-theme-mode]",
	)) {
		button.setAttribute(
			"aria-pressed",
			String(button.dataset.codeThemeMode === next),
		);
	}
	filterCards(gallery, search.value);
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
		setStatus(statusText());
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

function beginThemeSelection(card: CodeThemeCard): boolean {
	if (saving || card.getAttribute("aria-pressed") === "true") return false;
	const name = card.dataset.themeName;
	const mode = themeAppearance(card.dataset.themeAppearance);
	if (!name || !mode) return false;

	saving = true;
	setCardsDisabled(true);
	setStatus(`Applying ${card.dataset.themeLabel ?? name}…`);
	return true;
}

function applyThemeSelection(
	light: string,
	dark: string,
	appearanceValue: string,
	name: string,
): void {
	const mode = themeAppearance(appearanceValue);
	const themes = { light, dark };
	if (!mode || !name || !isPierreThemes(themes)) return;

	document.body.dataset.codeThemeLight = themes.light;
	document.body.dataset.codeThemeDark = themes.dark;
	updateSelection(mode, name);
	window.dispatchEvent(new CustomEvent("pi-ui-code-theme-changed", { detail: themes }));
	const card = document.querySelector<HTMLButtonElement>(
		`[data-theme-appearance="${mode}"][data-theme-name="${CSS.escape(name)}"]`,
	);
	setStatus(`Applied ${card?.dataset.themeLabel ?? name}`);
	saving = false;
	setCardsDisabled(false);
}

function failThemeSelection(): void {
	if (!saving) return;
	saving = false;
	setCardsDisabled(false);
	setStatus("Could not apply theme. Try again.");
}

function updateSelection(mode: CodeThemeAppearance, name: string): void {
	for (const card of document.querySelectorAll<HTMLButtonElement>(
		`[data-theme-appearance="${mode}"]`,
	)) {
		const selected = card.dataset.themeName === name;
		card.setAttribute("aria-pressed", String(selected));
	}
}

function filterCards(gallery: HTMLElement, value: string): void {
	const query = value.trim().toLocaleLowerCase();
	let visible = 0;
	for (const card of gallery.querySelectorAll<HTMLButtonElement>("[data-theme-name]")) {
		const matchesMode = card.dataset.themeAppearance === appearance;
		const matchesQuery = !query || card.dataset.themeLabel?.includes(query) === true;
		card.hidden = !(matchesMode && matchesQuery);
		if (matchesMode && matchesQuery) visible += 1;
	}
	setStatus(query ? `${visible} matching themes` : statusText());
}

function statusText(): string {
	return `${codeThemesFor(appearance).length} ${appearance} themes`;
}

function setCardsDisabled(disabled: boolean): void {
	for (const card of document.querySelectorAll<HTMLButtonElement>(
		"[data-theme-name]",
	)) {
		card.disabled = disabled;
	}
}

function setStatus(message: string): void {
	const status = document.getElementById("code-theme-status");
	if (status) status.textContent = message;
}

function themeDialog(): HTMLDialogElement | undefined {
	const dialog = document.getElementById("code-theme-dialog");
	return dialog instanceof HTMLDialogElement ? dialog : undefined;
}

function nextFrame(): Promise<void> {
	return new Promise((resolve) => requestAnimationFrame(() => resolve()));
}
