import os from "node:os";
import { join } from "node:path";

import { operatingSystem } from "#src/utils/platform.ts";

type AppDirectory = "cache" | "config" | "data";

const xdgVariables = {
	cache: "XDG_CACHE_HOME",
	config: "XDG_CONFIG_HOME",
	data: "XDG_DATA_HOME",
} as const;

const fallbackDirectories = {
	cache: ".cache",
	config: ".config",
	data: join(".local", "share"),
} as const;

/** Platform directory that holds this app's cache, config, or data files. */
function appDirectory(kind: AppDirectory): string {
	const home = os.homedir();
	if (operatingSystem === "windows") {
		if (kind === "config")
			return join(process.env.APPDATA ?? join(home, "AppData", "Roaming"), "pi-ui");
		const local = process.env.LOCALAPPDATA ?? join(home, "AppData", "Local");
		// Windows keeps the cache in its own subdirectory of the local app data.
		return kind === "cache" ? join(local, "pi-ui", "Cache") : join(local, "pi-ui");
	}
	if (operatingSystem === "darwin") {
		if (kind === "cache") return join(home, "Library", "Caches", "pi-ui");
		if (kind === "data") return join(home, "Library", "Application Support", "pi-ui");
	}
	return join(
		process.env[xdgVariables[kind]] ?? join(home, fallbackDirectories[kind]),
		"pi-ui",
	);
}

export function appCachePath(fileName: string): string {
	return join(appDirectory("cache"), fileName);
}

export function appConfigPath(): string {
	return join(appDirectory("config"), "config.json");
}

export function appDataPath(...segments: string[]): string {
	return join(appDirectory("data"), ...segments);
}
