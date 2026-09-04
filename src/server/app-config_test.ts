import { test } from "bun:test";
import { join } from "node:path";

import { assertEquals } from "#testing/assertions";
import { readTextFile, remove, writeTextFile } from "#testing/files";
import { makeTempDir } from "#testing/temp";

import { appConfigSchemaUrl } from "../config-schema.ts";
import { ensureAppConfig, updateAppConfig } from "./app-config.ts";

test("app config is created with its schema", async () => {
	const directory = await makeTempDir();
	const path = join(directory, "nested", "config.json");
	try {
		const config = await ensureAppConfig(path);
		assertEquals(config, { $schema: appConfigSchemaUrl });
		assertEquals(JSON.parse(await readTextFile(path)), config);
	} finally {
		await remove(directory, { recursive: true });
	}
});

test("app config creation preserves an existing file", async () => {
	const directory = await makeTempDir();
	const path = join(directory, "config.json");
	const existing = { future: true };
	try {
		await writeTextFile(path, JSON.stringify(existing));
		assertEquals(await ensureAppConfig(path), existing);
		assertEquals(JSON.parse(await readTextFile(path)), existing);
	} finally {
		await remove(directory, { recursive: true });
	}
});

test("app config updates preserve existing fields and schema", async () => {
	const directory = await makeTempDir();
	const path = join(directory, "config.json");
	try {
		await writeTextFile(path, JSON.stringify({ future: true }));
		await updateAppConfig((config) => {
			config.fonts = { mono: "Fira Code", sans: "IBM Plex Sans" };
		}, path);
		assertEquals(JSON.parse(await readTextFile(path)), {
			future: true,
			fonts: { mono: "Fira Code", sans: "IBM Plex Sans" },
			$schema: appConfigSchemaUrl,
		});
	} finally {
		await remove(directory, { recursive: true });
	}
});
