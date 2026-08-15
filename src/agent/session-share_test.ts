import { assertEquals, assertRejects } from "@std/assert";

import { shareSession, type SessionShareDependencies } from "./session-share.ts";

const encoder = new TextEncoder();

function dependencies(
	results: Array<{ code: number; stdout?: string; stderr?: string }>,
) {
	const calls: string[][] = [];
	const removed: string[] = [];
	const value: SessionShareDependencies = {
		tempFilePath: () => "/tmp/session.html",
		removeFile: (path) => {
			removed.push(path);
			return Promise.resolve();
		},
		runGh: (args) => {
			calls.push(args);
			const result = results.shift();
			if (!result) throw new Error("unexpected gh command");
			return Promise.resolve({
				code: result.code,
				stdout: encoder.encode(result.stdout ?? ""),
				stderr: encoder.encode(result.stderr ?? ""),
			});
		},
		shareViewerUrl: (gistId) => `https://viewer.test/#${gistId}`,
	};
	return { value, calls, removed };
}

Deno.test("shares the exported session as a secret gist", async () => {
	const deps = dependencies([
		{ code: 0 },
		{ code: 0, stdout: "https://gist.github.com/user/gist-id\n" },
	]);
	const exports: string[] = [];

	assertEquals(
		await shareSession(
			{
				exportToHtml: (path) => {
					exports.push(path ?? "");
					return Promise.resolve(path ?? "");
				},
			},
			deps.value,
		),
		{
			shareUrl: "https://viewer.test/#gist-id",
			gistUrl: "https://gist.github.com/user/gist-id",
		},
	);
	assertEquals(exports, ["/tmp/session.html"]);
	assertEquals(deps.calls, [
		["auth", "status"],
		["gist", "create", "--public=false", "/tmp/session.html"],
	]);
	assertEquals(deps.removed, ["/tmp/session.html"]);
});

Deno.test("reports missing GitHub authentication before exporting", async () => {
	const deps = dependencies([{ code: 1 }]);
	await assertRejects(
		() =>
			shareSession(
				{ exportToHtml: () => Promise.resolve("/tmp/session.html") },
				deps.value,
			),
		Error,
		"GitHub CLI is not logged in",
	);
	assertEquals(deps.removed, []);
});

Deno.test("cleans up the export when gist creation fails", async () => {
	const deps = dependencies([{ code: 0 }, { code: 1, stderr: "network unavailable" }]);
	await assertRejects(
		() =>
			shareSession(
				{ exportToHtml: (path) => Promise.resolve(path ?? "") },
				deps.value,
			),
		Error,
		"Failed to create gist: network unavailable",
	);
	assertEquals(deps.removed, ["/tmp/session.html"]);
});
