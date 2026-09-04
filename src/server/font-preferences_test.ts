import { test } from "bun:test";

import { assertEquals } from "#testing/assertions";
import { readTextFile, remove, writeTextFile } from "#testing/files";
import { makeTempFile } from "#testing/temp";

import { appConfigSchemaUrl } from "../config-schema.ts";
import { writeFontPreferences } from "./font-preferences.ts";

test("font preferences preserve config", async () => {
	const path = await makeTempFile();
	try {
		await writeTextFile(path, JSON.stringify({ future: { enabled: true } }));
		const fonts = {
			mono: "Fira Code",
			sans: "IBM Plex Sans",
		} as const;
		await writeFontPreferences(fonts, path);
		assertEquals(JSON.parse(await readTextFile(path)), {
			future: { enabled: true },
			fonts,
			$schema: appConfigSchemaUrl,
		});
	} finally {
		await remove(path);
	}
});
