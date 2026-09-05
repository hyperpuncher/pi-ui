import { DEFAULT_PIERRE_THEMES, type PierreThemes } from "./pierre-theme.ts";
import { isRecord, isString } from "./utils/type-guards.ts";

export type CodeThemeAppearance = keyof PierreThemes;
export type CodeThemeOption = Readonly<{
	appearance: CodeThemeAppearance;
	label: string;
	name: string;
}>;

export const CODE_THEME_PREVIEW =
	"// syntax preview\nconst greet = (name: string) => {\n  return `hello, ${name}!`;\n};";

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

const words = new Map<string, string>(
	Object.entries({
		ayu: "Ayu",
		cvd: "CVD",
		github: "GitHub",
		min: "Min",
		pierre: "Pierre",
		vscode: "VS Code",
	}),
);

function themeLabel(name: string): string {
	return name
		.split("-")
		.map(
			(word) =>
				words.get(word) ?? `${word[0]?.toUpperCase() ?? ""}${word.slice(1)}`,
		)
		.join(" ");
}

function option(name: string, appearance: CodeThemeAppearance): CodeThemeOption {
	return {
		appearance,
		label: themeLabel(name),
		name,
	};
}

const LIGHT_CODE_THEMES: readonly CodeThemeOption[] = lightThemeNames
	.map((name) => option(name, "light"))
	.toSorted((a, b) => a.label.localeCompare(b.label));
const DARK_CODE_THEMES: readonly CodeThemeOption[] = darkThemeNames
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

export function findCodeTheme<Value>(
	appearance: CodeThemeAppearance,
	name: Value,
): CodeThemeOption | undefined {
	return isString(name)
		? codeThemesFor(appearance).find((theme) => theme.name === name)
		: undefined;
}

export function validCodeThemes<Value>(value: Value): PierreThemes | undefined {
	if (!isRecord(value)) return undefined;
	const light = findCodeTheme("light", value.light)?.name;
	const dark = findCodeTheme("dark", value.dark)?.name;
	return light && dark ? { dark, light } : undefined;
}

export function defaultCodeThemes(): PierreThemes {
	return { ...DEFAULT_PIERRE_THEMES };
}
