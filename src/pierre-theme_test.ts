import { assertEquals } from "@std/assert";

import {
	DEFAULT_PIERRE_THEMES,
	getPierreThemes,
	setActiveCodeTheme,
} from "./pierre-theme.ts";

Deno.test("active Pierre themes discard catalog metadata", () => {
	setActiveCodeTheme({
		dark: "dark-theme",
		light: "light-theme",
		group: "pierre",
		label: "Catalog Theme",
	} as { dark: string; light: string });
	assertEquals(getPierreThemes(), {
		dark: "dark-theme",
		light: "light-theme",
	});

	setActiveCodeTheme(DEFAULT_PIERRE_THEMES);
});
