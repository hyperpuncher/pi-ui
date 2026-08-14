import { assertEquals } from "@std/assert";

import {
	DEFAULT_PIERRE_THEMES,
	getPierreThemes,
	setActiveCodeTheme,
} from "./pierre-theme.ts";

Deno.test("active Pierre themes discard catalog metadata", () => {
	const catalogTheme = {
		dark: "dark-theme",
		light: "light-theme",
		group: "pierre",
		label: "Catalog Theme",
	};
	setActiveCodeTheme(catalogTheme);
	assertEquals(getPierreThemes(), {
		dark: "dark-theme",
		light: "light-theme",
	});

	setActiveCodeTheme(DEFAULT_PIERRE_THEMES);
});
