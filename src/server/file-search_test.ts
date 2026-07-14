import { assertEquals, assertRejects } from "@std/assert";

import { searchFiles } from "./file-search.ts";

const output = (text: string, success = true): Deno.CommandOutput => ({
	success,
	code: success ? 0 : 1,
	signal: null,
	stdout: new TextEncoder().encode(text),
	stderr: new Uint8Array(),
});

Deno.test("file search preserves scoped ranking and result cap", async () => {
	let args: string[] = [];
	const lines = [
		"beta.txt",
		"alpha/",
		...Array.from({ length: 25 }, (_, index) => `alpha-${index}.txt`),
	].join("\n");
	const results = await searchFiles("/workspace", "src/alpha", undefined, (next) => {
		args = next;
		return Promise.resolve(output(lines));
	});
	assertEquals(args.slice(0, 2), ["--base-directory", "/workspace/src"]);
	assertEquals(results.length, 20);
	assertEquals(results[0].value, "src/alpha/");
	assertEquals(
		results.every((item) => item.value.startsWith("src/")),
		true,
	);
});

Deno.test("file search suggests closest sibling entries for an incorrect name", async () => {
	let calls = 0;
	const results = await searchFiles(
		"/workspace",
		"auth.jsonasdfasdf",
		undefined,
		() => {
			calls += 1;
			return Promise.resolve(
				output(calls === 1 ? "" : "auth.py\nauth.json\nbackend-oauth.md"),
			);
		},
	);
	assertEquals(
		results.map((item) => item.value),
		["auth.json", "auth.py", "backend-oauth.md"],
	);
});

Deno.test("closest file suggestions stay within the selected directory", async () => {
	const calls: string[][] = [];
	const results = await searchFiles(
		"/workspace",
		"src/auth.jsonasdfasdf",
		undefined,
		(args) => {
			calls.push(args);
			return Promise.resolve(
				output(calls.length === 1 ? "" : "auth.json\nauth.py"),
			);
		},
	);
	assertEquals(
		calls.map((args) => args[args.indexOf("--base-directory") + 1]),
		["/workspace/src", "/workspace/src"],
	);
	assertEquals(
		results.map((item) => item.value),
		["src/auth.json", "src/auth.py"],
	);
});

Deno.test("file search resets traversal scopes to the workspace", async () => {
	let baseDirectory = "";
	await searchFiles("/workspace", "../secret", undefined, (args) => {
		baseDirectory = args[args.indexOf("--base-directory") + 1];
		return Promise.resolve(output(""));
	});
	assertEquals(baseDirectory, "/workspace");
});

Deno.test("aborted fd search rethrows without manual fallback", async () => {
	const workspace = await Deno.makeTempDir();
	try {
		await Deno.writeTextFile(`${workspace}/fallback.txt`, "");
		const controller = new AbortController();
		const reason = new Error("cancelled");
		const search = searchFiles(
			workspace,
			"fallback",
			controller.signal,
			(_args, signal) =>
				new Promise((_resolve, reject) => {
					signal?.addEventListener("abort", () => reject(reason), {
						once: true,
					});
				}),
		);
		controller.abort(reason);
		await assertRejects(() => search, Error, "cancelled");
	} finally {
		await Deno.remove(workspace, { recursive: true });
	}
});

Deno.test("aborted unsuccessful fd output does not enter manual fallback", async () => {
	const workspace = await Deno.makeTempDir();
	try {
		await Deno.writeTextFile(`${workspace}/fallback.txt`, "");
		const controller = new AbortController();
		const reason = new Error("cancelled unsuccessful command");
		const search = searchFiles(
			workspace,
			"fallback",
			controller.signal,
			(_args, signal) =>
				new Promise((resolve) => {
					signal?.addEventListener("abort", () => resolve(output("", false)), {
						once: true,
					});
				}),
		);
		controller.abort(reason);
		await assertRejects(() => search, Error, "cancelled unsuccessful command");
	} finally {
		await Deno.remove(workspace, { recursive: true });
	}
});

Deno.test("unavailable fd falls back to manual search", async () => {
	const workspace = await Deno.makeTempDir();
	try {
		await Deno.writeTextFile(`${workspace}/fallback.txt`, "");
		const results = await searchFiles(workspace, "fallback", undefined, () =>
			Promise.reject(new Deno.errors.NotFound("fd")),
		);
		assertEquals(
			results.map((item) => item.value),
			["fallback.txt"],
		);
	} finally {
		await Deno.remove(workspace, { recursive: true });
	}
});
