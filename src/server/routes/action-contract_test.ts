import { assertEquals } from "@std/assert";

import { assertStringExcludes } from "../../testing/assertions.ts";
import { endpoints } from "./endpoints.ts";

const typescriptActionSources = [
	"../../commands/actions.ts",
	"../../ui/auth-dialog.tsx",
	"../../ui/llama-dialog.tsx",
	"../../ui/messages.tsx",
	"../../ui/page.tsx",
	"../../ui/pickers.tsx",
	"../../ui/prompt-action.tsx",
	"../../ui/prompt-box.tsx",
	"../../ui/prompt-pickers.tsx",
	"../../ui/prompt-status.tsx",
	"../../ui/prompt-toolbar.tsx",
	"../../ui/session-sidebar.tsx",
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

Deno.test("Datastar actions declare narrow request contracts", async () => {
	const source = (await readActionSources(typescriptActionSources)).join("\n");
	const actionCount = countMatches(source, /@(get|post|put|patch|delete)\(/g);
	const payloadCount = countMatches(source, /\bpayload\s*:/g);
	const filterCount = countMatches(source, /\bfilterSignals\s*:/g);
	assertEquals(actionCount, payloadCount + filterCount);
	assertStringExcludes(source, "include: /^$/");
	assertEquals(countMatches(source, /filterSignals\s*:\s*\{\s*include:\s*\/\^_/g), 0);
	for (const signal of ["workspaceReviewPreferences", "workspaceReviewComments"]) {
		assertEquals(source.includes(`include: /^${signal}\\./`), true);
	}
});

function countMatches(source: string, pattern: RegExp): number {
	return [...source.matchAll(pattern)].length;
}

function extractLiteralWriteActionPaths(source: string): string[] {
	const paths = source.matchAll(/@(?:post|put|patch|delete)\(\s*(["'])(\/[^"']*)\1/g);
	return [...paths].map((match) => match[2].split("?", 1)[0]);
}

async function readActionSources(paths: readonly string[]): Promise<string[]> {
	return await Promise.all(
		paths.map((path) => Deno.readTextFile(new URL(path, import.meta.url))),
	);
}
