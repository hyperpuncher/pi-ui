import { test } from "bun:test";

import { assertEquals } from "#testing/assertions";
import { readTextFile, remove, writeTextFile } from "#testing/files";
import { makeTempDir } from "#testing/temp";

import { defaultCodeThemes } from "../code-themes.ts";
import {
	readCodeThemePreference,
	writeCodeThemePreference,
} from "./code-theme-preferences.ts";

test("code theme preferences default, validate, and preserve config", async () => {
	const directory = await makeTempDir();
	const path = `${directory}/config.json`;
	try {
		assertEquals(await readCodeThemePreference(path), defaultCodeThemes());
		await writeTextFile(
			path,
			JSON.stringify({ codeTheme: "missing", future: { enabled: true } }),
		);
		assertEquals(await readCodeThemePreference(path), defaultCodeThemes());

		const themes = { dark: "github-dark", light: "github-light" };
		await writeCodeThemePreference(themes, path);
		assertEquals(await readCodeThemePreference(path), themes);
		assertEquals(JSON.parse(await readTextFile(path)).future, {
			enabled: true,
		});
	} finally {
		await remove(directory, { recursive: true });
	}
});
