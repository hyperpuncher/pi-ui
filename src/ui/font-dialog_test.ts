import { test } from "bun:test";

import { assertStringIncludes } from "#testing/assertions";

import { renderFontDialog } from "./font-dialog.tsx";

test("font dialog renders searchable interface and code font previews", () => {
	const html = renderFontDialog();
	assertStringIncludes(html, "Atkinson Hyperlegible Next");
	assertStringIncludes(html, "Atkinson Hyperlegible Mono");
	assertStringIncludes(html, 'role="radiogroup"');
	assertStringIncludes(html, 'type="radio"');
	assertStringIncludes(html, "Search fonts…");
	assertStringIncludes(html, "window.piUi.codeTheme.loadFontPreviews");
	assertStringIncludes(html, "cached web fallback");
});
