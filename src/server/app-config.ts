import os from "node:os";

import { dirname, join } from "@std/path";
import { Compile } from "typebox/compile";

import { appConfigSchemaUrl } from "../config-schema.ts";
import { type JsonObject, JsonObjectSchema } from "../utils/json-types.ts";

export type AppConfig = JsonObject;

const appConfigValidator = Compile(JsonObjectSchema);

let pendingWrite = Promise.resolve();

export async function readAppConfig(path = appConfigPath()): Promise<AppConfig> {
	try {
		const value = JSON.parse(await Deno.readTextFile(path));
		return appConfigValidator.Check(value) ? value : {};
	} catch (error) {
		if (error instanceof Deno.errors.NotFound || error instanceof SyntaxError) {
			return {};
		}
		throw error;
	}
}

export async function ensureAppConfig(path = appConfigPath()): Promise<AppConfig> {
	await Deno.mkdir(dirname(path), { recursive: true });
	const config: AppConfig = { $schema: appConfigSchemaUrl };
	try {
		await Deno.writeTextFile(path, serializeAppConfig(config), {
			createNew: true,
		});
		return config;
	} catch (error) {
		if (!(error instanceof Deno.errors.AlreadyExists)) throw error;
		return await readAppConfig(path);
	}
}

export async function updateAppConfig(
	update: (config: AppConfig) => void,
	path = appConfigPath(),
): Promise<void> {
	const write = pendingWrite.then(async () => {
		const config = await readAppConfig(path);
		update(config);
		config.$schema = appConfigSchemaUrl;
		await Deno.mkdir(dirname(path), { recursive: true });
		await Deno.writeTextFile(path, serializeAppConfig(config));
	});
	pendingWrite = write.catch(() => {});
	await write;
}

function serializeAppConfig(config: AppConfig): string {
	return `${JSON.stringify(config, null, "\t")}\n`;
}

function appConfigPath(): string {
	const home = os.homedir();
	if (Deno.build.os === "windows") {
		return join(
			Deno.env.get("APPDATA") ?? join(home, "AppData", "Roaming"),
			"pi-ui",
			"config.json",
		);
	}
	return join(
		Deno.env.get("XDG_CONFIG_HOME") ?? join(home, ".config"),
		"pi-ui",
		"config.json",
	);
}
