import type { FontPreferences } from "../fonts.ts";
import { updateAppConfig } from "./app-config.ts";

export async function writeFontPreferences(
	fonts: FontPreferences,
	path?: string,
): Promise<void> {
	await updateAppConfig((config) => {
		config.fonts = { ...fonts };
	}, path);
}
