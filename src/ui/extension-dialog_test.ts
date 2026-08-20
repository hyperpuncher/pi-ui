import { assertStringIncludes } from "@std/assert";

import { assertStringExcludes } from "../testing/assertions.ts";
import {
	renderExtensionDialog,
	renderExtensionDialogContent,
} from "./extension-dialog.tsx";

Deno.test("extension dialog escapes labels and posts attributed selections", () => {
	const html = renderExtensionDialogContent({
		id: "request-1",
		kind: "select",
		title: "<script>title</script>",
		options: ["<strong>option</strong>"],
	});

	assertStringExcludes(html, "<script>title</script>");
	assertStringExcludes(html, "<strong>option</strong>");
	assertStringIncludes(html, "&lt;script>title&lt;/script>");
	assertStringIncludes(html, "&lt;strong>option&lt;/strong>");
	assertStringIncludes(html, "/extensions/ui/respond");
	assertStringIncludes(html, "request-1");
});

Deno.test("extension dialog close uses the current backend signal", () => {
	const html = renderExtensionDialog(undefined);
	assertStringIncludes(html, "$extensionRequestId");
	assertStringIncludes(html, "extensionCancelled: true");
});
