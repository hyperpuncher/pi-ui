import { test } from "bun:test";

import { assertStringIncludes } from "#testing/assertions";

import { renderCodeThemeDialog } from "./code-theme-dialog.tsx";

test("code theme dialog delegates filtering and selection to datastar", () => {
	const html = renderCodeThemeDialog();

	assertStringIncludes(html, 'data-bind:code-theme-search=""');
	assertStringIncludes(html, "data-on:pi-ui-open-code-theme__window");
	assertStringIncludes(html, "$_codeThemeLight");
	assertStringIncludes(html, "$_codeThemeDark");
});
