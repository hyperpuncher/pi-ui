import os from "node:os";
import { join } from "node:path";

import { operatingSystem } from "./platform.ts";

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

/**
 * Round 6 F5: `bun test` must never touch the real cache directory —
 * `session-summary-cache.ts`'s cache-file rename raced a live app there
 * intermittently (round-5 audit finding 7, an EPERM on
 * `%LOCALAPPDATA%\pi-ui\Cache`). `scripts/test-env.ts` (this repo's
 * `bunfig.toml` `[test]` preload, so it runs before any test file imports
 * anything) sets this to a fresh temp directory for the whole `bun test`
 * process; unset outside of tests, so production behavior is unchanged.
 */
function cacheDirectoryOverride(): string | undefined {
	return process.env.PI_UI_CACHE_DIR?.trim() || undefined;
}

/** Platform directory that holds this app's cache, config, or data files. */
function appDirectory(kind: AppDirectory): string {
	if (kind === "cache") {
		const override = cacheDirectoryOverride();
		if (override) return override;
	}
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
