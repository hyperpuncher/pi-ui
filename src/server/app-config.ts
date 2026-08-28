import { mkdir, open } from "node:fs/promises";
import os from "node:os";
import { dirname, join } from "node:path";

import { Compile } from "typebox/compile";

import { appConfigSchemaUrl } from "../config-schema.ts";
import { isAlreadyExists, isNotFound } from "../utils/fs-errors.ts";
import { type JsonObject, JsonObjectSchema } from "../utils/json-types.ts";
import { operatingSystem } from "../utils/platform.ts";

export type AppConfig = JsonObject;

const appConfigValidator = Compile(JsonObjectSchema);

let pendingWrite = Promise.resolve();

export async function readAppConfig(path = appConfigPath()): Promise<AppConfig> {
	try {
		const value = JSON.parse(await Bun.file(path).text());
		return appConfigValidator.Check(value) ? value : {};
	} catch (error) {
		if (isNotFound(error) || error instanceof SyntaxError) {
			return {};
		}
		throw error;
	}
}

export async function ensureAppConfig(path = appConfigPath()): Promise<AppConfig> {
	await mkdir(dirname(path), { recursive: true });
	const config: AppConfig = { $schema: appConfigSchemaUrl };
	try {
		const file = await open(path, "wx");
		await file.writeFile(serializeAppConfig(config));
		await file.close();
		return config;
	} catch (error) {
		if (!isAlreadyExists(error)) throw error;
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
		await mkdir(dirname(path), { recursive: true });
		await Bun.write(path, serializeAppConfig(config));
	});
	pendingWrite = write.catch(() => {});
	await write;
}

function serializeAppConfig(config: AppConfig): string {
	return `${JSON.stringify(config, null, "\t")}\n`;
}

function appConfigPath(): string {
	const home = os.homedir();
	if (operatingSystem === "windows") {
		return join(
			process.env.APPDATA ?? join(home, "AppData", "Roaming"),
			"pi-ui",
			"config.json",
		);
	}
	return join(
		process.env.XDG_CONFIG_HOME ?? join(home, ".config"),
		"pi-ui",
		"config.json",
	);
}
