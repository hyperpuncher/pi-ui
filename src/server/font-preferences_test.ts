import { test } from "bun:test";

import { assertEquals } from "#testing/assertions";
import { readTextFile, remove, writeTextFile } from "#testing/files";
import { makeTempFile } from "#testing/temp";

import { defaultFonts } from "../fonts.ts";
import { readFontPreferences, writeFontPreferences } from "./font-preferences.ts";

test("font preferences default, validate, and preserve config", async () => {
	const path = await makeTempFile();
	try {
		await writeTextFile(path, JSON.stringify({ future: { enabled: true } }));
		assertEquals(await readFontPreferences(path), defaultFonts());

		const fonts = {
			mono: "Fira Code",
			sans: "IBM Plex Sans",
		} as const;
		await writeFontPreferences(fonts, path);
		assertEquals(await readFontPreferences(path), fonts);
		assertEquals(JSON.parse(await readTextFile(path)).future, {
			enabled: true,
		});
	} finally {
		await remove(path);
	}
});
