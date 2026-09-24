import { test } from "bun:test";
import { mkdir, rm, symlink } from "node:fs/promises";
import { relative } from "node:path";

import { assertEquals, assertRejects } from "#testing/assertions";
import { hasFileSymlinkSupport } from "#testing/symlink";
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

// These three tests create *file* symlinks, which — unlike directory symlinks
// (see `#testing/symlink`'s `symlinkDir`) — have no privilege-free Windows
// equivalent (NTFS junctions are directories-only). On a host lacking
// `SeCreateSymbolicLinkPrivilege` (no elevation, Developer Mode off) they skip
// rather than fail on an OS capability the test isn't meant to exercise.
const testFileSymlink = test.skipIf(!hasFileSymlinkSupport());

testFileSymlink(
	"workspace files list source files without dependencies or symlinks",
	async () => {
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
	},
);

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
		if (!("contents" in first)) throw new Error("Could not read text file");
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

testFileSymlink(
	"linked files outside the workspace read and save through absolute paths, relative paths and symlinks",
	async () => {
		const workspace = await makeTempDir();
		const outside = await makeTempFile();
		try {
			await symlink(outside, `${workspace}/linked`);
			for (const filePath of [outside, relative(workspace, outside), "linked"]) {
				await Bun.write(outside, "original");
				const file = await readWorkspaceFile(workspace, filePath);
				if (!("contents" in file)) throw new Error("Could not read text file");
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
	},
);

test("workspace files describe native previews and preserve editable source", async () => {
	const workspace = await makeTempDir();
	try {
		await Bun.write(`${workspace}/image.png`, new Uint8Array([0x89, 0x50]));
		await Bun.write(`${workspace}/vector.svg`, "<svg></svg>");
		await Bun.write(`${workspace}/README.md`, "# Preview");
		await Bun.write(`${workspace}/font.woff2`, new Uint8Array([0x77, 0x4f]));
		assertEquals(await readWorkspaceFile(workspace, "image.png"), {
			path: "image.png",
			preview: { kind: "image", mimeType: "image/png" },
			revision: `${Bun.file(`${workspace}/image.png`).lastModified}:2`,
			size: 2,
		});
		const vector = await readWorkspaceFile(workspace, "vector.svg");
		if (!("contents" in vector)) throw new Error("Missing SVG source");
		assertEquals(vector.contents, "<svg></svg>");
		assertEquals(vector.preview, {
			kind: "image",
			mimeType: "image/svg+xml",
		});
		const markdown = await readWorkspaceFile(workspace, "README.md");
		if (!("contents" in markdown)) throw new Error("Missing Markdown source");
		assertEquals(markdown.contents, "# Preview");
		assertEquals(markdown.preview, {
			kind: "markdown",
			mimeType: "text/markdown",
		});
		assertEquals(await readWorkspaceFile(workspace, "font.woff2"), {
			path: "font.woff2",
			preview: { kind: "font", mimeType: "font/woff2" },
			revision: `${Bun.file(`${workspace}/font.woff2`).lastModified}:2`,
			size: 2,
		});
	} finally {
		await rm(workspace, { recursive: true });
	}
});

testFileSymlink(
	"workspace files handle unsupported files and keep tree mutations workspace-scoped",
	async () => {
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
	},
);
