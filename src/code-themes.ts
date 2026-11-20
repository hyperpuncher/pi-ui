import type { Theme } from "@pierre/highlights";
import { themes } from "@pierre/highlights/themes/loader";

import { type CodeThemes, DEFAULT_CODE_THEMES } from "#src/pierre-theme.ts";
import { isRecord, isString } from "#src/utils/type-guards.ts";

export type CodeThemeAppearance = keyof CodeThemes;
export type CodeThemeOption = Readonly<{
	appearance: CodeThemeAppearance;
	label: string;
	name: string;
}>;

export const CODE_THEME_PREVIEW =
	"// syntax preview\nconst greet = (name: string) => {\n  return `hello, ${name}!`;\n};";

const CODE_THEME_OBJECTS = new Map<string, Theme>();

/** Every theme bundled with Highlights, sorted by display name. */
const CODE_THEMES: readonly CodeThemeOption[] = (
	await Promise.all(
		Object.entries(themes).map(async ([name, load]) => {
			const theme = (await load()).default;
			CODE_THEME_OBJECTS.set(name, theme);
			const appearance: CodeThemeAppearance =
				theme.appearance === "dark" ? "dark" : "light";
			return { appearance, label: theme.name, name };
		}),
	)
).toSorted((a, b) => a.label.localeCompare(b.label));

export function codeThemeObject(name: string): Theme | undefined {
	return CODE_THEME_OBJECTS.get(name);
}

export function codeThemesFor(
	appearance: CodeThemeAppearance,
): readonly CodeThemeOption[] {
	return CODE_THEMES.filter((theme) => theme.appearance === appearance);
}

export function findCodeTheme<Value>(
	appearance: CodeThemeAppearance,
	name: Value,
): CodeThemeOption | undefined {
	return isString(name)
		? CODE_THEMES.find(
				(theme) => theme.appearance === appearance && theme.name === name,
			)
		: undefined;
}

export function validCodeThemes<Value>(value: Value): CodeThemes | undefined {
	if (!isRecord(value)) return undefined;
	const light = findCodeTheme("light", value.light)?.name;
	const dark = findCodeTheme("dark", value.dark)?.name;
	return light && dark ? { dark, light } : undefined;
}

export function defaultCodeThemes(): CodeThemes {
	return { ...DEFAULT_CODE_THEMES };
}
