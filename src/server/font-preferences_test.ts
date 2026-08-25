import { assertEquals } from "@std/assert";

import { defaultFonts } from "../fonts.ts";
import { readFontPreferences, writeFontPreferences } from "./font-preferences.ts";

Deno.test("font preferences default, validate, and preserve config", async () => {
	const path = await Deno.makeTempFile();
	try {
		await Deno.writeTextFile(path, JSON.stringify({ future: { enabled: true } }));
		assertEquals(await readFontPreferences(path), defaultFonts());

		const fonts = {
			mono: "Fira Code",
			sans: "IBM Plex Sans",
		} as const;
		await writeFontPreferences(fonts, path);
		assertEquals(await readFontPreferences(path), fonts);
		assertEquals(JSON.parse(await Deno.readTextFile(path)).future, {
			enabled: true,
		});
	} finally {
		await Deno.remove(path);
	}
});
