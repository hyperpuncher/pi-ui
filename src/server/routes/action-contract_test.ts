import { assertEquals, assertStringIncludes } from "@std/assert";

import { commandActions } from "../../commands/actions.ts";
import { appCommandCatalog } from "../../commands/catalog.ts";
import { endpoints } from "./endpoints.ts";

const typescriptActionSources = [
	"../../commands/actions.ts",
	"../../ui/auth-dialog.tsx",
	"../../ui/messages.tsx",
	"../../ui/page.tsx",
	"../../ui/pickers.tsx",
	"../../ui/prompt-action.tsx",
	"../../ui/prompt-box.tsx",
	"../../ui/prompt-pickers.tsx",
	"../../ui/prompt-status.tsx",
	"../../ui/prompt-toolbar.tsx",
	"../../ui/session-transition.tsx",
	"../../ui/tree-picker.tsx",
];

const browserActionSources = [
	...typescriptActionSources,
	"../../../static/app/main.js",
	"../../../static/app/display-refresh.js",
	"../../../static/app/file-transfer.js",
	"../../../static/app/pickers.js",
];

export function extractLiteralActionPaths(source: string): string[] {
	const paths = source.matchAll(
		/@(?:get|post|put|patch|delete)\(\s*(["'])(\/[^"']*)\1/g,
	);
	return [...paths].map((match) => match[2].split("?", 1)[0]);
}

export function unknownActionPaths(
	source: string,
	registeredPaths: readonly string[],
): string[] {
	const registered = new Set(registeredPaths);
	return [...new Set(extractLiteralActionPaths(source))].filter(
		(path) => !registered.has(path),
	);
}

Deno.test("literal action path extraction and validation", () => {
	const registered = ["/prompt", "/messages/enhance"];
	assertEquals(
		extractLiteralActionPaths(`
			@post('/prompt')
			@get("/messages/enhance?id=message-1")
			const ordinary = '/not-an-action';
			// This comment contains no Datastar action: /also-not-an-action.
		`),
		["/prompt", "/messages/enhance"],
	);
	assertEquals(unknownActionPaths("@post('/prompt')", registered), []);
	assertEquals(
		unknownActionPaths("@get('/messages/enhance?id=message-1')", registered),
		[],
	);
	assertEquals(unknownActionPaths("@post('/unknown')", registered), ["/unknown"]);
});

Deno.test("TypeScript write actions use endpoint constants", async () => {
	const sources = await readActionSources(typescriptActionSources);
	assertEquals(extractLiteralWriteActionPaths(sources.join("\n")), []);
});

Deno.test("each literal browser action references a registered endpoint", async () => {
	const browserActions = await readActionSources(browserActionSources);
	assertEquals(
		unknownActionPaths(browserActions.join("\n"), Object.values(endpoints)),
		[],
	);
});

Deno.test("dynamic and rendered endpoint references remain explicit", async () => {
	const [
		authDialog,
		page,
		promptAction,
		promptBox,
		promptPickers,
		promptToolbar,
		catalog,
		dialogs,
		main,
	] = await Promise.all(
		[
			"../../ui/auth-dialog.tsx",
			"../../ui/page.tsx",
			"../../ui/prompt-action.tsx",
			"../../ui/prompt-box.tsx",
			"../../ui/prompt-pickers.tsx",
			"../../ui/prompt-toolbar.tsx",
			"../../commands/catalog.ts",
			"../../../static/app/dialogs.js",
			"../../main.ts",
		].map((path) => Deno.readTextFile(new URL(path, import.meta.url))),
	);
	const renderedCommandActions = Object.values(commandActions).join("\n");

	assertStringIncludes(authDialog, "endpoints.authLoginStart");
	assertStringIncludes(authDialog, "endpoints.authLogout");
	assertStringIncludes(authDialog, "@post('${action}'");
	assertStringIncludes(page, "data-files-pick-endpoint={endpoints.filesPick}");
	assertStringIncludes(page, "data-files-import-endpoint={endpoints.filesImport}");
	assertStringIncludes(
		page,
		"data-display-refresh-endpoint={endpoints.displayRefresh}",
	);
	assertStringIncludes(promptBox, "@get('${endpoints.filesSearch}'");
	assertStringIncludes(promptBox, "filterSignals: { include: /^fileQuery$/ }");
	assertStringIncludes(promptBox, "requestCancellation: 'cleanup'");

	assertStringIncludes(page, "data-init={`@get('${endpoints.sessionsStream}', {");
	assertStringIncludes(renderedCommandActions, "window.piUi.dialogs.toggleSession()");

	for (const authAction of [endpoints.authOpenLogin, endpoints.authOpenLogout]) {
		assertStringIncludes(
			browserActionsFor(`${authDialog}\n${renderedCommandActions}`, authAction),
			"filterSignals: { include: /^$/ }",
		);
	}

	assertEquals(appCommandCatalog.length, Object.keys(commandActions).length);
	assertEquals(
		appCommandCatalog.find((command) => command.id === "toggle-review")?.shortcut,
		{ display: "ctrl D", native: "CmdOrCtrl+D", keys: ["d"] },
	);
	assertStringIncludes(promptToolbar, "!evt.shiftKey && !evt.altKey");
	assertEquals(`${promptAction}\n${promptBox}`.match(/\$prompt = '';/g)?.length, 2);
	assertEquals(/@post|document\.|window\./.test(catalog), false);
	assertStringIncludes(dialogs, "export function openWorkspace()");
	assertStringIncludes(renderedCommandActions, "window.piUi.dialogs.openWorkspace()");
	assertStringIncludes(promptPickers, "openWorkspaceDialogAction()");
	assertStringIncludes(main, '"window.piUi.dialogs.openWorkspace()"');
});

function extractLiteralWriteActionPaths(source: string): string[] {
	const paths = source.matchAll(/@(?:post|put|patch|delete)\(\s*(["'])(\/[^"']*)\1/g);
	return [...paths].map((match) => match[2].split("?", 1)[0]);
}

async function readActionSources(paths: readonly string[]): Promise<string[]> {
	return await Promise.all(
		paths.map((path) => Deno.readTextFile(new URL(path, import.meta.url))),
	);
}

function browserActionsFor(source: string, path: string): string {
	const index = source.indexOf(`@post('${path}'`);
	return index < 0 ? "" : source.slice(index, index + 160);
}
