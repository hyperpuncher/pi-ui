import { test } from "bun:test";

import {
	DEFAULT_PIERRE_THEMES,
	getPierreThemes,
	setActiveCodeTheme,
} from "#src/pierre-theme.ts";
import { assertEquals } from "#testing/assertions";

test("active Pierre themes discard catalog metadata", () => {
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
