import { test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";

import { assertEquals } from "#testing/assertions";
import { makeTempDir } from "#testing/temp";

import { appConfigSchemaUrl } from "../config-schema.ts";
import { ensureAppConfig, updateAppConfig } from "./app-config.ts";

test("app config is created with its schema", async () => {
	const directory = await makeTempDir();
	const path = join(directory, "nested", "config.json");
	try {
		const config = await ensureAppConfig(path);
		assertEquals(config, { $schema: appConfigSchemaUrl });
		assertEquals(JSON.parse(await Bun.file(path).text()), config);
	} finally {
		await rm(directory, { recursive: true });
	}
});

test("app config creation preserves an existing file", async () => {
	const directory = await makeTempDir();
	const path = join(directory, "config.json");
	const existing = { future: true };
	try {
		await Bun.write(path, JSON.stringify(existing));
		assertEquals(await ensureAppConfig(path), existing);
		assertEquals(JSON.parse(await Bun.file(path).text()), existing);
	} finally {
		await rm(directory, { recursive: true });
	}
});

test("app config updates preserve existing fields and schema", async () => {
	const directory = await makeTempDir();
	const path = join(directory, "config.json");
	try {
		await Bun.write(path, JSON.stringify({ future: true }));
		await updateAppConfig((config) => {
			config.fonts = { mono: "Fira Code", sans: "IBM Plex Sans" };
		}, path);
		assertEquals(JSON.parse(await Bun.file(path).text()), {
			future: true,
			fonts: { mono: "Fira Code", sans: "IBM Plex Sans" },
			$schema: appConfigSchemaUrl,
		});
	} finally {
		await rm(directory, { recursive: true });
	}
});
