import { assertEquals, assertStringIncludes } from "@std/assert";

import { endpoints } from "./endpoints.ts";

const browserActionSources = [
	"../../commands/registry.ts",
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
	const [authDialog, commandRegistry, page, promptBox] = await Promise.all(
		[
			"../../ui/auth-dialog.tsx",
			"../../commands/registry.ts",
			"../../ui/page.tsx",
			"../../ui/prompt-box.tsx",
		].map((path) => Deno.readTextFile(new URL(path, import.meta.url))),
	);

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

	for (const authAction of ["/auth/open-login", "/auth/open-logout"]) {
		assertStringIncludes(
			browserActionsFor(`${authDialog}\n${commandRegistry}`, authAction),
			"filterSignals: { include: /^$/ }",
		);
	}
});

function browserActionsFor(source: string, path: string): string {
	const index = source.indexOf(`@post('${path}'`);
	return index < 0 ? "" : source.slice(index, index + 160);
}
