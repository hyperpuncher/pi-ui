import { test } from "bun:test";

import {
	DEFAULT_CODE_THEMES,
	activeCodeThemes,
	setCodeThemes,
} from "#src/pierre-theme.ts";
import { assertEquals } from "#testing/assertions";

test("active code themes discard catalog metadata", () => {
	const catalogTheme = {
		dark: "dark-theme",
		light: "light-theme",
		group: "pierre",
		label: "Catalog Theme",
	};
	setCodeThemes(catalogTheme);
	assertEquals(activeCodeThemes, {
		dark: "dark-theme",
		light: "light-theme",
	});

	setCodeThemes(DEFAULT_CODE_THEMES);
});
