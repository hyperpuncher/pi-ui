import { isRecord, isString } from "#src/utils/type-guards.ts";

export type CodeThemes = Readonly<{ dark: string; light: string }>;

export function isCodeThemes<Value>(value: Value): value is Value & CodeThemes {
	return isRecord(value) && isString(value.dark) && isString(value.light);
}

export const DEFAULT_CODE_THEMES: CodeThemes = {
	dark: "pierre-dark-soft",
	light: "pierre-light",
};

export let activeCodeThemes = DEFAULT_CODE_THEMES;

export function codeThemeKey(): string {
	return `${activeCodeThemes.light}:${activeCodeThemes.dark}`;
}

export function setCodeThemes(themes: CodeThemes): void {
	// Pierre treats every enumerable value as a theme name. Copy only the
	// supported keys because callers may pass richer catalog objects.
	activeCodeThemes = { dark: themes.dark, light: themes.light };
}
