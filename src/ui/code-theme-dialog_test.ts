import { assertStringIncludes } from "@std/assert";

import { renderCodeThemeDialog } from "./code-theme-dialog.tsx";

Deno.test("code theme dialog delegates filtering and selection to datastar", () => {
	const html = renderCodeThemeDialog();

	assertStringIncludes(html, 'data-bind:code-theme-search=""');
	assertStringIncludes(html, "data-on:pi-ui-open-code-theme__window");
	assertStringIncludes(html, "$codeThemeAppearance === &#34;light&#34;");
	assertStringIncludes(html, "$codeThemeSearch.trim().toLocaleLowerCase()");
	assertStringIncludes(html, "$_codeThemeLight");
	assertStringIncludes(html, "$_codeThemeDark");
});
