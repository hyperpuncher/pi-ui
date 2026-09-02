import { test } from "bun:test";

import { assertStringIncludes } from "#testing/assertions";

import { assertStringExcludes } from "../testing/assertions.ts";
import { renderExtensionDialogContent } from "./extension-dialog.tsx";

test("extension dialog escapes labels and posts attributed selections", () => {
	const html = renderExtensionDialogContent({
		id: "request-1",
		kind: "select",
		title: "<script>title</script>",
		options: ["<strong>option</strong>"],
	});

	assertStringExcludes(html, "<script>title</script>");
	assertStringExcludes(html, "<strong>option</strong>");
	assertStringIncludes(html, "&lt;script&gt;title&lt;/script&gt;");
	assertStringIncludes(html, "&lt;strong&gt;option&lt;/strong&gt;");
	assertStringIncludes(html, "/extensions/ui/respond");
	assertStringIncludes(html, "request-1");
});
