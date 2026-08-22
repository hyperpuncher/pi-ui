import { assertEquals } from "@std/assert";
import { join } from "@std/path";

import { appConfigSchemaUrl } from "../config-schema.ts";
import { ensureAppConfig } from "./app-config.ts";

Deno.test("app config is created with its schema", async () => {
	const directory = await Deno.makeTempDir();
	const path = join(directory, "nested", "config.json");
	try {
		const config = await ensureAppConfig(path);
		assertEquals(config, { $schema: appConfigSchemaUrl });
		assertEquals(JSON.parse(await Deno.readTextFile(path)), config);
	} finally {
		await Deno.remove(directory, { recursive: true });
	}
});

Deno.test("app config creation preserves an existing file", async () => {
	const directory = await Deno.makeTempDir();
	const path = join(directory, "config.json");
	const existing = { future: true };
	try {
		await Deno.writeTextFile(path, JSON.stringify(existing));
		assertEquals(await ensureAppConfig(path), existing);
		assertEquals(JSON.parse(await Deno.readTextFile(path)), existing);
	} finally {
		await Deno.remove(directory, { recursive: true });
	}
});
