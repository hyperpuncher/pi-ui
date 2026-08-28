import os from "node:os";
import { join } from "node:path";

import { operatingSystem } from "./platform.ts";

export function appCachePath(fileName: string): string {
	const home = os.homedir();
	if (operatingSystem === "windows") {
		return join(
			process.env.LOCALAPPDATA ?? join(home, "AppData", "Local"),
			"pi-ui",
			"Cache",
			fileName,
		);
	}
	if (operatingSystem === "darwin") {
		return join(home, "Library", "Caches", "pi-ui", fileName);
	}
	return join(process.env.XDG_CACHE_HOME ?? join(home, ".cache"), "pi-ui", fileName);
}
