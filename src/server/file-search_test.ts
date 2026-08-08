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

Deno.test("file search excludes hidden paths unless explicitly requested", async () => {
	const calls: string[][] = [];
	for (const query of ["config", ".config"]) {
		await searchFiles("/workspace", query, undefined, (args) => {
			calls.push(args);
			return Promise.resolve(output(".config/"));
		});
	}

	assertEquals(calls[0].includes("--hidden"), false);
	assertEquals(calls[1].includes("--hidden"), true);
	assertEquals(calls[1].at(-1), String.raw`\.config`);
});

Deno.test("terminal dot includes hidden entries in a scoped directory", async () => {
	let args: string[] = [];
	const results = await searchFiles(
		"/workspace",
		"dotfiles/pi/.",
		undefined,
		(next) => {
			args = next;
			return Promise.resolve(output(".pi/"));
		},
	);

	assertEquals(args[args.indexOf("--base-directory") + 1], "/workspace/dotfiles/pi");
	assertEquals(args.includes("--hidden"), true);
	assertEquals(
		results.map((item) => item.value),
		["dotfiles/pi/.pi/"],
	);
});

Deno.test("file search scopes trailing directory queries before recursing", async () => {
	let args: string[] = [];
	await searchFiles("/workspace", ".dotfiles/", undefined, (next) => {
		args = next;
		return Promise.resolve(output("config/nvim/init.lua"));
	});

	assertEquals(args[args.indexOf("--base-directory") + 1], "/workspace/.dotfiles");
	assertEquals(args.at(-1), "--hidden");
});

Deno.test("file search excludes dependency and environment directories", async () => {
	let args: string[] = [];
	await searchFiles("/workspace", "package", undefined, (next) => {
		args = next;
		return Promise.resolve(output("package.json"));
	});

	const exclusions = args.flatMap((arg, index) =>
		arg === "--exclude" ? [args[index + 1]] : [],
	);
	assertEquals(exclusions.includes("node_modules"), true);
	assertEquals(exclusions.includes("__pycache__"), true);
	assertEquals(exclusions.includes(".venv"), true);
	assertEquals(exclusions.includes("venv"), true);
});

Deno.test("file search ranks shallower equal-quality matches first", async () => {
	const results = await searchFiles("/workspace", "config.ts", undefined, () =>
		Promise.resolve(output("packages/generated/config.ts\nconfig.ts\nsrc/config.ts")),
	);

	assertEquals(
		results.map((item) => item.value),
		["config.ts", "src/config.ts", "packages/generated/config.ts"],
	);
});

Deno.test("file search tries shallow results before bounded recursion", async () => {
	const calls: string[][] = [];
	const results = await searchFiles("/workspace", "button", undefined, (args) => {
		calls.push(args);
		const depth = args[args.indexOf("--max-depth") + 1];
		return Promise.resolve(output(depth === "1" ? "" : "src/components/button.tsx"));
	});

	assertEquals(
		calls.map((args) => args[args.indexOf("--max-depth") + 1]),
		["1", "4"],
	);
	assertEquals(
		calls.every((args) => !args.includes("--follow")),
		true,
	);
	assertEquals(
		calls.every((args) => args.includes("100")),
		true,
	);
	assertEquals(
		results.map((item) => item.value),
		["src/components/button.tsx"],
	);
});

Deno.test("file search returns no typo suggestions after recursive miss", async () => {
	const calls: string[][] = [];
	const results = await searchFiles(
		"/workspace",
		"src/auth.jsonasdfasdf",
		undefined,
		(args) => {
			calls.push(args);
			return Promise.resolve(output(""));
		},
	);

	assertEquals(results, []);
	assertEquals(calls.length, 2);
	assertEquals(
		calls.map((args) => args[args.indexOf("--base-directory") + 1]),
		["/workspace/src", "/workspace/src"],
	);
	assertEquals(
		calls.every((args) => args.at(-1) === "auth\\.jsonasdfasdf"),
		true,
	);
});

Deno.test("file search supports absolute and parent paths", async () => {
	const baseDirectories: string[] = [];
	for (const query of ["/tmp/file", "../secret/file"]) {
		await searchFiles("/workspace", query, undefined, (args) => {
			baseDirectories.push(args[args.indexOf("--base-directory") + 1]);
			return Promise.resolve(output("match.txt"));
		});
	}
	assertEquals(baseDirectories, ["/tmp", "/secret"]);
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

Deno.test("manual file search applies explicit hidden path behavior", async () => {
	const workspace = await Deno.makeTempDir();
	try {
		await Deno.mkdir(`${workspace}/.config`);
		await Deno.mkdir(`${workspace}/node_modules/package`, { recursive: true });
		await Deno.writeTextFile(`${workspace}/.config/settings.json`, "");
		await Deno.writeTextFile(`${workspace}/node_modules/package/settings.json`, "");
		await Deno.writeTextFile(`${workspace}/settings.json`, "");
		const unavailable = () => Promise.reject(new Deno.errors.NotFound("fd"));

		assertEquals(
			(await searchFiles(workspace, "settings", undefined, unavailable)).map(
				(item) => item.value,
			),
			["settings.json"],
		);
		assertEquals(
			(
				await searchFiles(workspace, ".config/settings", undefined, unavailable)
			).map((item) => item.value),
			[".config/settings.json"],
		);
	} finally {
		await Deno.remove(workspace, { recursive: true });
	}
});

Deno.test("unavailable fd falls back to recursive manual search", async () => {
	const workspace = await Deno.makeTempDir();
	try {
		await Deno.mkdir(`${workspace}/src/components`, { recursive: true });
		await Deno.writeTextFile(`${workspace}/src/components/button.tsx`, "");
		const results = await searchFiles(workspace, "button", undefined, () =>
			Promise.reject(new Deno.errors.NotFound("fd")),
		);
		assertEquals(
			results.map((item) => item.value),
			["src/components/button.tsx"],
		);
	} finally {
		await Deno.remove(workspace, { recursive: true });
	}
});

Deno.test("unavailable fd falls back to manual search including empty queries", async () => {
	const workspace = await Deno.makeTempDir();
	try {
		await Deno.writeTextFile(`${workspace}/fallback.txt`, "");
		for (const query of ["fallback", ""]) {
			const results = await searchFiles(workspace, query, undefined, () =>
				Promise.reject(new Deno.errors.NotFound("fd")),
			);
			assertEquals(
				results.map((item) => item.value),
				["fallback.txt"],
			);
		}
	} finally {
		await Deno.remove(workspace, { recursive: true });
	}
});
