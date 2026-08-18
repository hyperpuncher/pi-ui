import { type AutoTitleConfig, parseAutoTitleConfig } from "../agent/auto-title.ts";
import { readAppConfig } from "./app-config.ts";

export async function readAutoTitleConfig(path?: string): Promise<AutoTitleConfig> {
	const config = await readAppConfig(path);
	return parseAutoTitleConfig(config.autoTitle);
}
