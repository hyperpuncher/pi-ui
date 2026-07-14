import { assertFalse, assertStringIncludes } from "@std/assert";

import type { AppRenderSnapshot } from "../state/app-store.ts";
import { renderFilePickerResults, renderSlashPicker } from "./pickers.tsx";
import { renderModelPicker } from "./prompt-box.tsx";

Deno.test("slash picker anchors its selected result nearest the prompt", () => {
	const html = renderSlashPicker({
		slashCommands: [
			{ name: "login", description: "Log in", source: "system" },
			{ name: "logout", description: "Log out", source: "system" },
		],
	} as unknown as AppRenderSnapshot);
	assertStringIncludes(html, 'id="slash-picker-list"');
	assertStringIncludes(html, "flex-col-reverse");
	assertStringIncludes(html, 'aria-selected="true"');
});

Deno.test("model picker distinguishes missing auth from an unselected model", () => {
	const withoutProvider = renderModelPicker({
		models: [],
		currentModel: undefined,
	} as unknown as AppRenderSnapshot);
	assertStringIncludes(withoutProvider, "no provider");
	assertStringIncludes(withoutProvider, "Log in to a provider");
	assertStringIncludes(withoutProvider, "/auth/open-login");
	assertFalse(withoutProvider.includes("dropdown-menu"));

	const withoutSelection = renderModelPicker({
		models: [
			{
				id: "claude-sonnet",
				provider: "anthropic",
				name: "Claude Sonnet",
				configured: true,
				scoped: false,
			},
		],
		currentModel: undefined,
	} as unknown as AppRenderSnapshot);
	assertStringIncludes(withoutSelection, "choose model");
});

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
	assertStringIncludes(html, "flex-col-reverse");
	assertStringIncludes(html, 'role="option"');
	assertStringIncludes(html, "&lt;unsafe>.ts");
	assertStringIncludes(html, "src/&lt;unsafe>.ts");
	assertStringIncludes(html, "file");
});
