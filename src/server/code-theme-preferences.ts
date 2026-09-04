import type { PierreThemes } from "../pierre-theme.ts";
import { updateAppConfig } from "./app-config.ts";

export async function writeCodeThemePreference(
	themes: PierreThemes,
	path?: string,
): Promise<void> {
	await updateAppConfig((config) => {
		config.codeTheme = { ...themes };
	}, path);
}
