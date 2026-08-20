import { assertStringIncludes } from "@std/assert";

import { assertStringExcludes } from "../testing/assertions.ts";
import { renderExtensionWidgets } from "./extension-widgets.tsx";

Deno.test("extension widgets render their placement and escape lines", () => {
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
	assertStringIncludes(html, "&lt;script>line&lt;/script>");
});
