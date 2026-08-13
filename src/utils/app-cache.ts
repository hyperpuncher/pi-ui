import os from "node:os";

import { join } from "@std/path";

export function appCachePath(fileName: string): string {
	const home = os.homedir();
	if (Deno.build.os === "windows") {
		return join(
			Deno.env.get("LOCALAPPDATA") ?? join(home, "AppData", "Local"),
			"pi-ui",
			"Cache",
			fileName,
		);
	}
	if (Deno.build.os === "darwin") {
		return join(home, "Library", "Caches", "pi-ui", fileName);
	}
	return join(
		Deno.env.get("XDG_CACHE_HOME") ?? join(home, ".cache"),
		"pi-ui",
		fileName,
	);
}
