import { assertEquals, assertRejects } from "@std/assert";

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

Deno.test("workspace files list source files without dependencies or symlinks", async () => {
	const workspace = await Deno.makeTempDir();
	const outside = await Deno.makeTempFile();
	try {
		await Deno.mkdir(`${workspace}/src`, { recursive: true });
		await Deno.mkdir(`${workspace}/node_modules/package`, { recursive: true });
		await Deno.mkdir(`${workspace}/.github`, { recursive: true });
		await Deno.writeTextFile(`${workspace}/src/main.ts`, "main");
		await Deno.writeTextFile(`${workspace}/.gitignore`, "dist");
		await Deno.writeTextFile(`${workspace}/.github/workflow.yml`, "jobs: {}");
		await Deno.writeTextFile(`${workspace}/node_modules/package/index.js`, "ignored");
		await Deno.symlink(outside, `${workspace}/outside.txt`);

		assertEquals(await listWorkspaceFiles(workspace), [
			".github/",
			".github/workflow.yml",
			".gitignore",
			"src/",
			"src/main.ts",
		]);
	} finally {
		await Deno.remove(workspace, { recursive: true });
		await Deno.remove(outside);
	}
});

Deno.test("workspace files can omit hidden directories outside Git repositories", async () => {
	const workspace = await Deno.makeTempDir();
	try {
		await Deno.mkdir(`${workspace}/.cache`, { recursive: true });
		await Deno.mkdir(`${workspace}/src`, { recursive: true });
		await Deno.writeTextFile(`${workspace}/.cache/generated.json`, "{}");
		await Deno.writeTextFile(`${workspace}/.env`, "VALUE=1");
		await Deno.writeTextFile(`${workspace}/src/main.ts`, "main");

		assertEquals(
			await listWorkspaceFiles(workspace, { includeHiddenDirectories: false }),
			[".env", "src/", "src/main.ts"],
		);
	} finally {
		await Deno.remove(workspace, { recursive: true });
	}
});

Deno.test("workspace entries create, rename, and remove files and folders", async () => {
	const workspace = await Deno.makeTempDir();
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
		await Deno.remove(workspace, { recursive: true });
	}
});

Deno.test("workspace files read and save with revision conflict protection", async () => {
	const workspace = await Deno.makeTempDir();
	try {
		await Deno.writeTextFile(`${workspace}/value.ts`, "export const value = 1;\n");
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
		await Deno.remove(workspace, { recursive: true });
	}
});

Deno.test("workspace files handle unsupported files and reject unsafe paths", async () => {
	const workspace = await Deno.makeTempDir();
	const outside = await Deno.makeTempFile();
	try {
		await Deno.writeFile(`${workspace}/binary`, new Uint8Array([0xff, 0xfe]));
		await Deno.writeFile(
			`${workspace}/large`,
			new Uint8Array(maximumWorkspaceFileBytes + 1),
		);
		await Deno.symlink(outside, `${workspace}/outside`);

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

		for (const [file, message] of [
			["../secret", "outside the workspace"],
			["outside", "outside the workspace"],
		] as const) {
			await assertRejects(
				() => readWorkspaceFile(workspace, file),
				WorkspaceFileError,
				message,
			);
		}
	} finally {
		await Deno.remove(workspace, { recursive: true });
		await Deno.remove(outside);
	}
});
