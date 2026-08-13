import { DEFAULT_PIERRE_THEMES, type PierreThemes } from "./pierre-theme.ts";

export type CodeThemeAppearance = keyof PierreThemes;
export type CodeThemeOption = Readonly<{
	appearance: CodeThemeAppearance;
	group: "pierre" | "shiki";
	label: string;
	name: string;
}>;

const lightThemeNames = [
	"pierre-light",
	"pierre-light-soft",
	"pierre-light-vibrant",
	"pierre-light-protanopia-deuteranopia",
	"pierre-light-tritanopia",
	"ayu-light",
	"catppuccin-latte",
	"everforest-light",
	"github-light",
	"github-light-default",
	"github-light-high-contrast",
	"gruvbox-light-hard",
	"gruvbox-light-medium",
	"gruvbox-light-soft",
	"horizon-bright",
	"kanagawa-lotus",
	"light-plus",
	"material-theme-lighter",
	"min-light",
	"night-owl-light",
	"one-light",
	"rose-pine-dawn",
	"slack-ochin",
	"snazzy-light",
	"solarized-light",
	"vitesse-light",
] as const;

const darkThemeNames = [
	"pierre-dark",
	"pierre-dark-soft",
	"pierre-dark-vibrant",
	"pierre-dark-protanopia-deuteranopia",
	"pierre-dark-tritanopia",
	"ayu-dark",
	"ayu-mirage",
	"catppuccin-frappe",
	"catppuccin-macchiato",
	"catppuccin-mocha",
	"everforest-dark",
	"github-dark",
	"github-dark-default",
	"github-dark-dimmed",
	"github-dark-high-contrast",
	"gruvbox-dark-hard",
	"gruvbox-dark-medium",
	"gruvbox-dark-soft",
	"horizon",
	"kanagawa-wave",
	"kanagawa-dragon",
	"dark-plus",
	"material-theme",
	"material-theme-darker",
	"material-theme-ocean",
	"material-theme-palenight",
	"min-dark",
	"night-owl",
	"one-dark-pro",
	"rose-pine",
	"rose-pine-moon",
	"slack-dark",
	"andromeeda",
	"solarized-dark",
	"vitesse-dark",
	"vitesse-black",
	"aurora-x",
	"dracula",
	"dracula-soft",
	"houston",
	"laserwave",
	"monokai",
	"nord",
	"plastic",
	"poimandres",
	"red",
	"synthwave-84",
	"tokyo-night",
	"vesper",
] as const;

const words: Record<string, string> = {
	ayu: "Ayu",
	cvd: "CVD",
	github: "GitHub",
	min: "Min",
	pierre: "Pierre",
	vscode: "VS Code",
};

function themeLabel(name: string): string {
	return name
		.split("-")
		.map((word) => words[word] ?? `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`)
		.join(" ");
}

function option(name: string, appearance: CodeThemeAppearance): CodeThemeOption {
	return {
		appearance,
		group: name.startsWith("pierre-") ? "pierre" : "shiki",
		label: themeLabel(name),
		name,
	};
}

export const LIGHT_CODE_THEMES: readonly CodeThemeOption[] = lightThemeNames
	.map((name) => option(name, "light"))
	.toSorted((a, b) => a.label.localeCompare(b.label));
export const DARK_CODE_THEMES: readonly CodeThemeOption[] = darkThemeNames
	.map((name) => option(name, "dark"))
	.toSorted((a, b) => a.label.localeCompare(b.label));
export const CODE_THEMES: readonly CodeThemeOption[] = [
	...LIGHT_CODE_THEMES,
	...DARK_CODE_THEMES,
];

export function codeThemesFor(
	appearance: CodeThemeAppearance,
): readonly CodeThemeOption[] {
	return appearance === "light" ? LIGHT_CODE_THEMES : DARK_CODE_THEMES;
}

export function findCodeTheme(
	appearance: CodeThemeAppearance,
	name: unknown,
): CodeThemeOption | undefined {
	return typeof name === "string"
		? codeThemesFor(appearance).find((theme) => theme.name === name)
		: undefined;
}

export function validCodeThemes(value: unknown): PierreThemes | undefined {
	if (typeof value !== "object" || value === null) return undefined;
	const themes = value as Record<string, unknown>;
	const light = findCodeTheme("light", themes.light)?.name;
	const dark = findCodeTheme("dark", themes.dark)?.name;
	return light && dark ? { dark, light } : undefined;
}

export function defaultCodeThemes(): PierreThemes {
	return { ...DEFAULT_PIERRE_THEMES };
}
