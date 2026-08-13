import { defaultCodeThemes, validCodeThemes } from "../code-themes.ts";
import type { PierreThemes } from "../pierre-theme.ts";
import { readAppConfig, updateAppConfig } from "./app-config.ts";

export async function readCodeThemePreference(path?: string): Promise<PierreThemes> {
	const config = await readAppConfig(path);
	return validCodeThemes(config.codeTheme) ?? defaultCodeThemes();
}

export async function writeCodeThemePreference(
	themes: PierreThemes,
	path?: string,
): Promise<void> {
	await updateAppConfig((config) => {
		config.codeTheme = { ...themes };
	}, path);
}
