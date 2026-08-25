import { defaultFonts, type FontPreferences, validFonts } from "../fonts.ts";
import { readAppConfig, updateAppConfig } from "./app-config.ts";

export async function readFontPreferences(path?: string): Promise<FontPreferences> {
	const config = await readAppConfig(path);
	return validFonts(config.fonts) ?? defaultFonts();
}

export async function writeFontPreferences(
	fonts: FontPreferences,
	path?: string,
): Promise<void> {
	await updateAppConfig((config) => {
		config.fonts = { ...fonts };
	}, path);
}
