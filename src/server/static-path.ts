import { join } from "node:path";
import { fileURLToPath } from "node:url";

export const staticRoot = Bun.isStandaloneExecutable
	? join(import.meta.dir, "static")
	: fileURLToPath(new URL("../../static", import.meta.url));
