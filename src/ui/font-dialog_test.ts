import { test } from "bun:test";

import { assertStringIncludes } from "#testing/assertions";

import { renderFontDialog } from "./font-dialog.tsx";

test("font dialog renders searchable interface and code font previews", () => {
	const html = renderFontDialog();
	assertStringIncludes(html, "Atkinson Hyperlegible Next");
	assertStringIncludes(html, "Atkinson Hyperlegible Mono");
	assertStringIncludes(html, "Inter");
	assertStringIncludes(html, "JetBrains Mono");
	assertStringIncludes(html, 'role="radiogroup"');
	assertStringIncludes(html, 'type="radio"');
	assertStringIncludes(html, 'data-bind="_fontMono"');
	assertStringIncludes(html, 'data-bind:font-search=""');
	assertStringIncludes(html, "Search fonts…");
	assertStringIncludes(html, "window.piUi.codeTheme.loadFontPreviews");
	assertStringIncludes(html, "type User = { name: string };");
	assertStringIncludes(html, "({ name }: User) => name");
	assertStringIncludes(html, "cached web fallback");
});
