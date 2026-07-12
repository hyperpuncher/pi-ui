import { assertEquals, assertStringIncludes } from "@std/assert";

import { commandActions } from "../../commands/actions.ts";
import { appCommandCatalog } from "../../commands/catalog.ts";
import { endpoints } from "./endpoints.ts";

const browserActionSources = [
	"../../commands/actions.ts",
	"../../ui/auth-dialog.tsx",
	"../../ui/messages.tsx",
	"../../ui/page.tsx",
	"../../ui/pickers.tsx",
	"../../ui/prompt-box.tsx",
	"../../ui/session-transition.tsx",
	"../../ui/tree-picker.tsx",
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

Deno.test("each literal browser action references a registered endpoint", async () => {
	const browserActions = await Promise.all(
		browserActionSources.map((path) =>
			Deno.readTextFile(new URL(path, import.meta.url)),
		),
	);
	assertEquals(
		unknownActionPaths(browserActions.join("\n"), Object.values(endpoints)),
		[],
	);
});

Deno.test("dynamic and rendered endpoint references remain explicit", async () => {
	const [authDialog, page, promptBox, catalog, dialogs, main] = await Promise.all(
		[
			"../../ui/auth-dialog.tsx",
			"../../ui/page.tsx",
			"../../ui/prompt-box.tsx",
			"../../commands/catalog.ts",
			"../../../static/app/dialogs.js",
			"../../main.ts",
		].map((path) => Deno.readTextFile(new URL(path, import.meta.url))),
	);
	const renderedCommandActions = Object.values(commandActions).join("\n");

	assertStringIncludes(
		authDialog,
		'const action = mode === "login" ? "/auth/login/start" : "/auth/logout"',
	);
	assertStringIncludes(authDialog, "@post('${action}'");
	assertStringIncludes(page, "data-files-import-endpoint={endpoints.filesImport}");
	assertStringIncludes(
		page,
		"data-display-refresh-endpoint={endpoints.displayRefresh}",
	);
	assertStringIncludes(promptBox, "@get('${endpoints.filesSearch}'");
	assertStringIncludes(promptBox, "filterSignals: { include: /^fileQuery$/ }");
	assertStringIncludes(promptBox, "requestCancellation: 'cleanup'");

	for (const sessionAction of [renderedCommandActions]) {
		const open = sessionAction.indexOf("window.piUi.dialogs.openSession()");
		const post = sessionAction.indexOf(`@post('${endpoints.sessionsList}'`, open);
		if (open < 0 || post < open) {
			throw new Error("Session actions must open and focus before refreshing");
		}
	}

	for (const authAction of ["/auth/open-login", "/auth/open-logout"]) {
		assertStringIncludes(
			browserActionsFor(`${authDialog}\n${renderedCommandActions}`, authAction),
			"filterSignals: { include: /^$/ }",
		);
	}

	assertEquals(appCommandCatalog.length, Object.keys(commandActions).length);
	assertEquals(/@post|document\.|window\./.test(catalog), false);
	assertStringIncludes(dialogs, "export function openWorkspace()");
	assertStringIncludes(renderedCommandActions, "window.piUi.dialogs.openWorkspace()");
	assertStringIncludes(promptBox, "openWorkspaceDialogAction()");
	assertStringIncludes(main, '"window.piUi.dialogs.openWorkspace()"');
});

function browserActionsFor(source: string, path: string): string {
	const index = source.indexOf(`@post('${path}'`);
	return index < 0 ? "" : source.slice(index, index + 160);
}
