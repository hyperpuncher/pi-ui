import { assertStringIncludes } from "@std/assert";

import { renderFilePickerResults } from "./pickers.tsx";

Deno.test("file picker fragments escape dynamic values and expose list semantics", () => {
	const html = renderFilePickerResults([
		{
			value: `src/"<unsafe>.ts`,
			label: `<unsafe>.ts`,
			description: `src/<unsafe>.ts`,
			isDirectory: false,
		},
	]);
	assertStringIncludes(html, 'id="file-picker-results"');
	assertStringIncludes(html, 'role="listbox"');
	assertStringIncludes(html, 'role="option"');
	assertStringIncludes(html, "&lt;unsafe>.ts");
	assertStringIncludes(html, "src/&lt;unsafe>.ts");
	assertStringIncludes(html, "file");
});

Deno.test("file picker renders an accessible empty state", () => {
	const html = renderFilePickerResults([]);
	assertStringIncludes(html, 'role="status"');
	assertStringIncludes(html, "No files found.");
});
