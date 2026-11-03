import { mkdir, open } from "node:fs/promises";
import { dirname } from "node:path";

import { appConfigSchemaUrl } from "#src/config-schema.ts";
import { appConfigPath } from "#src/utils/app-dirs.ts";
import { isAlreadyExists, isNotFound } from "#src/utils/fs-errors.ts";
import { isJsonObject, type JsonObject, type JsonValue } from "#src/utils/type-guards.ts";

export type AppConfig = JsonObject;

let pendingWrite = Promise.resolve();

async function readAppConfig(path = appConfigPath()): Promise<AppConfig> {
	try {
		const value: JsonValue = await Bun.file(path).json();
		return isJsonObject(value) ? value : {};
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
