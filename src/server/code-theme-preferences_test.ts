import { test } from "bun:test";

import { assertEquals } from "#testing/assertions";
import { readTextFile, remove, writeTextFile } from "#testing/files";
import { makeTempDir } from "#testing/temp";

import { appConfigSchemaUrl } from "../config-schema.ts";
import { writeCodeThemePreference } from "./code-theme-preferences.ts";

test("code theme preferences preserve config", async () => {
	const directory = await makeTempDir();
	const path = `${directory}/config.json`;
	try {
		await writeTextFile(path, JSON.stringify({ future: { enabled: true } }));
		const themes = { dark: "github-dark", light: "github-light" };
		await writeCodeThemePreference(themes, path);
		assertEquals(JSON.parse(await readTextFile(path)), {
			future: { enabled: true },
			codeTheme: themes,
			$schema: appConfigSchemaUrl,
		});
	} finally {
		await remove(directory, { recursive: true });
	}
});
