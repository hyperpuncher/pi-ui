import { test } from "bun:test";

import { renderExtensionWidgets } from "#src/ui/extension-widgets.tsx";
import { assertStringIncludes } from "#testing/assertions";

import { assertStringExcludes } from "../testing/assertions.ts";

test("extension widgets render their placement and escape lines", () => {
	const html = renderExtensionWidgets(
		{
			extensionWidgets: [
				{
					key: "example",
					lines: ["<script>line</script>"],
					placement: "aboveEditor",
				},
			],
		},
		"aboveEditor",
	);

	assertStringIncludes(html, 'id="extension-widgets-above"');
	assertStringIncludes(html, 'data-extension-widget="example"');
	assertStringExcludes(html, "<script>line</script>");
	assertStringIncludes(html, "&lt;script&gt;line&lt;/script&gt;");
});
