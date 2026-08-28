import { test } from "bun:test";
import * as path from "node:path";

import { assertEquals } from "#testing/assertions";
import { mkdir, remove, writeTextFile } from "#testing/files";
import { makeTempDir } from "#testing/temp";

import { browseWorkspaceDirectories, searchWorkspaces } from "./workspace-search.ts";

test("workspace search completes matching directories", async () => {
	const root = await makeTempDir();
	try {
		await mkdir(path.join(root, "alpha"));
		await mkdir(path.join(root, "alpine"));
		await mkdir(path.join(root, "beta"));
		await mkdir(path.join(root, ".hidden"));
		await writeTextFile(path.join(root, "alphabet.txt"), "");

		assertEquals(await searchWorkspaces(root, path.join(root, "alp")), [
			{ path: path.join(root, "alpha") },
			{ path: path.join(root, "alpine") },
		]);
		assertEquals(await searchWorkspaces(root, path.join(root, ".h")), [
			{ path: path.join(root, ".hidden") },
		]);
	} finally {
		await remove(root, { recursive: true });
	}
});

test("workspace browser lists directories and resolves relative paths", async () => {
	const root = await makeTempDir();
	try {
		await mkdir(path.join(root, "alpha"));
		await mkdir(path.join(root, "beta"));
		await mkdir(path.join(root, ".hidden"));
		await writeTextFile(path.join(root, "file.txt"), "");

		assertEquals(await browseWorkspaceDirectories(root, ".", false), {
			path: root,
			parent: path.dirname(root),
			directories: [path.join(root, "alpha"), path.join(root, "beta")],
			showHidden: false,
		});
		assertEquals((await browseWorkspaceDirectories(root, ".", true)).directories, [
			path.join(root, ".hidden"),
			path.join(root, "alpha"),
			path.join(root, "beta"),
		]);
	} finally {
		await remove(root, { recursive: true });
	}
});

test("workspace search resolves relative paths from the active workspace", async () => {
	const root = await makeTempDir();
	try {
		await mkdir(path.join(root, "projects"));
		await mkdir(path.join(root, "projects", "pi-ui"));

		assertEquals(await searchWorkspaces(root, "projects/pi"), [
			{ path: path.join(root, "projects", "pi-ui") },
		]);
	} finally {
		await remove(root, { recursive: true });
	}
});
