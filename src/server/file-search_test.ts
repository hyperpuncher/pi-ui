import { test } from "bun:test";
import { homedir } from "node:os";
import { relative } from "node:path";

import { CombinedAutocompleteProvider } from "@earendil-works/pi-tui";

import { assertEquals, assertRejects } from "#testing/assertions";
import { mkdir, remove, writeTextFile } from "#testing/files";
import { makeTempDir } from "#testing/temp";

import { getToolPath } from "../../node_modules/@earendil-works/pi-coding-agent/dist/utils/tools-manager.js";
import { outputCommand } from "../utils/command.ts";
import { searchFiles } from "./file-search.ts";

// Integration tests use the real provisioned/system fd, without downloading in tests.
const fdPath = getToolPath("fd") ?? undefined;

test.skipIf(!fdPath)(
	"file search respects ignore rules and includes deep and hidden matches",
	async () => {
		const workspace = await makeTempDir();
		try {
			assertEquals(
				(await outputCommand("git", { args: ["init", "--quiet", workspace] }))
					.success,
				true,
			);
			await writeTextFile(`${workspace}/.gitignore`, "ignored/\n*.log\n");
			await writeTextFile(`${workspace}/.ignore`, "extra/\n");
			await mkdir(`${workspace}/src/deep/a/b/c`, { recursive: true });
			await writeTextFile(
				`${workspace}/src/.gitignore`,
				"*.tmp\n!target-keep.tmp\n",
			);
			for (const directory of ["ignored", "extra", ".hidden"])
				await mkdir(`${workspace}/${directory}`);
			for (const file of [
				"target.txt",
				".hidden/target.txt",
				"src/deep/a/b/c/target.txt",
				"src/target-keep.tmp",
				"src/target-skip.tmp",
				"ignored/target.txt",
				"extra/target.txt",
				"target.log",
			]) {
				await writeTextFile(`${workspace}/${file}`, "");
			}
			const results = await searchFiles(workspace, "target", undefined, fdPath);
			assertEquals(results.map((item) => item.value).sort(), [
				"@.hidden/target.txt",
				"@src/deep/a/b/c/target.txt",
				"@src/target-keep.tmp",
				"@target.txt",
			]);
		} finally {
			await remove(workspace, { recursive: true });
		}
	},
);

test.skipIf(!fdPath)(
	"file search preserves pi suggestions for scoped paths, quoting, and result limits",
	async () => {
		const workspace = await makeTempDir();
		try {
			await mkdir(`${workspace}/src`);
			await mkdir(`${workspace}/space dir`);
			await writeTextFile(`${workspace}/space dir/space file.txt`, "");
			for (let i = 0; i < 25; i++)
				await writeTextFile(`${workspace}/src/target-${i}.txt`, "");
			const provider = new CombinedAutocompleteProvider([], workspace, fdPath);
			for (const query of [
				"",
				"target",
				"src/target",
				`${workspace}/src/target`,
				`~/${relative(homedir(), workspace)}/src/target`,
				'"space dir/space',
				"missing-no-such-path",
			]) {
				const prefix = `@${query}`;
				const expected = await provider.getSuggestions(
					[prefix],
					0,
					prefix.length,
					{ signal: new AbortController().signal },
				);
				const actual = await searchFiles(workspace, query, undefined, fdPath);
				assertEquals(actual, expected?.items ?? []);
			}
			assertEquals(
				(await searchFiles(workspace, "src/target", undefined, fdPath)).length,
				20,
			);
		} finally {
			await remove(workspace, { recursive: true });
		}
	},
);

test("unavailable fd never falls back to manual completion", async () => {
	const workspace = await makeTempDir();
	try {
		await writeTextFile(`${workspace}/fallback.txt`, "");
		for (const executable of [undefined, `${workspace}/missing-fd`]) {
			for (const query of ["", "fallback", `${workspace}/fallback`]) {
				assertEquals(
					await searchFiles(workspace, query, undefined, executable),
					[],
				);
			}
		}
	} finally {
		await remove(workspace, { recursive: true });
	}
});

test.skipIf(!fdPath)(
	"file search propagates cancellation before and during discovery",
	async () => {
		const workspace = await makeTempDir();
		try {
			const controller = new AbortController();
			const pending = searchFiles(workspace, "", controller.signal, fdPath);
			controller.abort(new Error("cancelled file search"));
			await assertRejects(() => pending, Error, "cancelled file search");
			await assertRejects(
				() => searchFiles(workspace, "", controller.signal, fdPath),
				Error,
				"cancelled file search",
			);
		} finally {
			await remove(workspace, { recursive: true });
		}
	},
);
