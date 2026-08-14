import Type from "typebox";
import { Compile } from "typebox/compile";

export type PierreThemes = Readonly<{ dark: string; light: string }>;

const pierreThemesValidator = Compile(
	Type.Object({ dark: Type.String(), light: Type.String() }),
);

export function isPierreThemes<Value>(value: Value): value is Value & PierreThemes {
	return pierreThemesValidator.Check(value);
}

export const DEFAULT_PIERRE_THEMES: PierreThemes = {
	dark: "pierre-dark",
	light: "pierre-light-soft",
};

let activeThemes = DEFAULT_PIERRE_THEMES;

export function getActiveCodeThemeId(): string {
	return `${activeThemes.light}:${activeThemes.dark}`;
}

export function getPierreThemes(): PierreThemes {
	return activeThemes;
}

export function setActiveCodeTheme(themes: PierreThemes): void {
	// Pierre treats every enumerable value as a theme name. Copy only the
	// supported keys because callers may pass richer catalog objects.
	activeThemes = { dark: themes.dark, light: themes.light };
}
