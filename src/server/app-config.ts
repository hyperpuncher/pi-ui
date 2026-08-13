import os from "node:os";

import { dirname, join } from "@std/path";

import { isRecord } from "../utils/type-guards.ts";

export type AppConfig = Record<string, unknown>;

let pendingWrite = Promise.resolve();

export async function readAppConfig(path = appConfigPath()): Promise<AppConfig> {
	try {
		const value: unknown = JSON.parse(await Deno.readTextFile(path));
		return isRecord(value) ? value : {};
	} catch (error) {
		if (error instanceof Deno.errors.NotFound || error instanceof SyntaxError) {
			return {};
		}
		throw error;
	}
}

export async function updateAppConfig(
	update: (config: AppConfig) => void,
	path = appConfigPath(),
): Promise<void> {
	const write = pendingWrite.then(async () => {
		const config = await readAppConfig(path);
		update(config);
		await Deno.mkdir(dirname(path), { recursive: true });
		await Deno.writeTextFile(path, `${JSON.stringify(config, null, "\t")}\n`);
	});
	pendingWrite = write.catch(() => {});
	await write;
}

export function appConfigPath(): string {
	const home = os.homedir();
	if (Deno.build.os === "windows") {
		return join(
			Deno.env.get("APPDATA") ?? join(home, "AppData", "Roaming"),
			"pi-ui",
			"config.json",
		);
	}
	if (Deno.build.os === "darwin") {
		return join(home, "Library", "Application Support", "pi-ui", "config.json");
	}
	return join(
		Deno.env.get("XDG_CONFIG_HOME") ?? join(home, ".config"),
		"pi-ui",
		"config.json",
	);
}
