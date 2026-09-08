import { test } from "bun:test";
import { mkdir, rm, symlink } from "node:fs/promises";
import { relative } from "node:path";

import { assertEquals, assertRejects } from "#testing/assertions";
import { makeTempDir, makeTempFile } from "#testing/temp";

import {
	createWorkspaceEntry,
	listWorkspaceFiles,
	moveWorkspaceEntry,
	maximumWorkspaceFileBytes,
	readWorkspaceFile,
	removeWorkspaceEntry,
	WorkspaceFileError,
	writeWorkspaceFile,
} from "./workspace-files.ts";

test("workspace files list source files without dependencies or symlinks", async () => {
	const workspace = await makeTempDir();
	const outside = await makeTempFile();
	try {
		await mkdir(`${workspace}/src`, { recursive: true });
		await mkdir(`${workspace}/node_modules/package`, { recursive: true });
		await mkdir(`${workspace}/.github`, { recursive: true });
		await Bun.write(`${workspace}/src/main.ts`, "main");
		await Bun.write(`${workspace}/.gitignore`, "dist");
		await Bun.write(`${workspace}/.github/workflow.yml`, "jobs: {}");
		await Bun.write(`${workspace}/node_modules/package/index.js`, "ignored");
		await symlink(outside, `${workspace}/outside.txt`);

		assertEquals(await listWorkspaceFiles(workspace), [
			".github/",
			".github/workflow.yml",
			".gitignore",
			"src/",
			"src/main.ts",
		]);
	} finally {
		await rm(workspace, { recursive: true });
		await rm(outside);
	}
});

test("workspace files can omit hidden directories outside Git repositories", async () => {
	const workspace = await makeTempDir();
	try {
		await mkdir(`${workspace}/.cache`, { recursive: true });
		await mkdir(`${workspace}/src`, { recursive: true });
		await Bun.write(`${workspace}/.cache/generated.json`, "{}");
		await Bun.write(`${workspace}/.env`, "VALUE=1");
		await Bun.write(`${workspace}/src/main.ts`, "main");

		assertEquals(
			await listWorkspaceFiles(workspace, { includeHiddenDirectories: false }),
			[".env", "src/", "src/main.ts"],
		);
	} finally {
		await rm(workspace, { recursive: true });
	}
});

test("workspace entries create, rename, and remove files and folders", async () => {
	const workspace = await makeTempDir();
	try {
		assertEquals(await createWorkspaceEntry(workspace, "src", "folder"), {
			path: "src",
		});
		assertEquals(await createWorkspaceEntry(workspace, "src/value.ts", "file"), {
			path: "src/value.ts",
		});
		assertEquals(
			await moveWorkspaceEntry(workspace, "src/value.ts", "src/renamed.ts"),
			{ path: "src/renamed.ts" },
		);
		assertEquals(await listWorkspaceFiles(workspace), ["src/", "src/renamed.ts"]);
		await removeWorkspaceEntry(workspace, "src");
		assertEquals(await listWorkspaceFiles(workspace), []);
	} finally {
		await rm(workspace, { recursive: true });
	}
});

test("workspace files read and save with revision conflict protection", async () => {
	const workspace = await makeTempDir();
	try {
		await Bun.write(`${workspace}/value.ts`, "export const value = 1;\n");
		const first = await readWorkspaceFile(workspace, "value.ts");
		if ("message" in first) throw new Error(first.message);
		assertEquals(first.contents, "export const value = 1;\n");

		const saved = await writeWorkspaceFile(
			workspace,
			"value.ts",
			"export const value = 2;\n",
			first.revision,
		);
		assertEquals(saved.contents, "export const value = 2;\n");
		await assertRejects(
			() => writeWorkspaceFile(workspace, "value.ts", "stale", first.revision),
			WorkspaceFileError,
			"changed on disk",
		);
	} finally {
		await rm(workspace, { recursive: true });
	}
});

test("linked files outside the workspace read and save through absolute paths, relative paths and symlinks", async () => {
	const workspace = await makeTempDir();
	const outside = await makeTempFile();
	try {
		await symlink(outside, `${workspace}/linked`);
		for (const filePath of [outside, relative(workspace, outside), "linked"]) {
			await Bun.write(outside, "original");
			const file = await readWorkspaceFile(workspace, filePath);
			if ("message" in file) throw new Error(file.message);
			assertEquals(file.contents, "original");
			const saved = await writeWorkspaceFile(
				workspace,
				filePath,
				"edited",
				file.revision,
			);
			assertEquals(saved.contents, "edited");
			assertEquals(await Bun.file(outside).text(), "edited");
			await assertRejects(
				() => writeWorkspaceFile(workspace, filePath, "stale", file.revision),
				WorkspaceFileError,
				"changed on disk",
			);
		}
	} finally {
		await rm(workspace, { recursive: true });
		await rm(outside);
	}
});

test("workspace files handle unsupported files and keep tree mutations workspace-scoped", async () => {
	const workspace = await makeTempDir();
	const outside = await makeTempFile();
	try {
		await Bun.write(`${workspace}/binary`, new Uint8Array([0xff, 0xfe]));
		await Bun.write(
			`${workspace}/large`,
			new Uint8Array(maximumWorkspaceFileBytes + 1),
		);
		await symlink(outside, `${workspace}/outside`);

		await assertRejects(
			() => createWorkspaceEntry(workspace, "../created", "file"),
			WorkspaceFileError,
			"outside the workspace",
		);
		await assertRejects(
			() => removeWorkspaceEntry(workspace, "outside"),
			WorkspaceFileError,
			"Symbolic links",
		);

		assertEquals(await readWorkspaceFile(workspace, "binary"), {
			message: "Only text files can be viewed.",
			path: "binary",
			size: 2,
		});
		assertEquals(await readWorkspaceFile(workspace, "large"), {
			message: "File is too large to view in pi-ui.",
			path: "large",
			size: maximumWorkspaceFileBytes + 1,
		});

		await assertRejects(
			() => readWorkspaceFile(workspace, "missing"),
			WorkspaceFileError,
			"File not found",
		);
	} finally {
		await rm(workspace, { recursive: true });
		await rm(outside);
	}
});
