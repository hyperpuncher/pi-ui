import { assertEquals } from "@std/assert";

import { defaultCodeThemes } from "../code-themes.ts";
import {
	readCodeThemePreference,
	writeCodeThemePreference,
} from "./code-theme-preferences.ts";

Deno.test("code theme preferences default, validate, and preserve config", async () => {
	const directory = await Deno.makeTempDir();
	const path = `${directory}/config.json`;
	try {
		assertEquals(await readCodeThemePreference(path), defaultCodeThemes());
		await Deno.writeTextFile(
			path,
			JSON.stringify({ codeTheme: "missing", future: { enabled: true } }),
		);
		assertEquals(await readCodeThemePreference(path), defaultCodeThemes());

		const themes = { dark: "github-dark", light: "github-light" };
		await writeCodeThemePreference(themes, path);
		assertEquals(await readCodeThemePreference(path), themes);
		assertEquals(JSON.parse(await Deno.readTextFile(path)).future, {
			enabled: true,
		});
	} finally {
		await Deno.remove(directory, { recursive: true });
	}
});
