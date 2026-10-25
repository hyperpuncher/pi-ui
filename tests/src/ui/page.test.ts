import { test } from "bun:test";

import { renderPage } from "#src/ui/page.tsx";
import { assertStringIncludes } from "#testing/assertions";
import { appRenderSnapshot } from "#tests/src/ui/test-fixtures.ts";

test("initial page includes the selected color scheme", () => {
	for (const theme of ["system", "light", "dark"] as const) {
		const page = renderPage({ ...appRenderSnapshot({}), theme, messages: [] });
		assertStringIncludes(
			page,
			`<meta name="color-scheme" content="${theme === "system" ? "light dark" : theme}"`,
		);
	}
});
