import { test } from "bun:test";
import { mkdir, rm, stat } from "node:fs/promises";

import { parsePatchFiles } from "@pierre/diffs";

import { assertEquals, assertRejects, assertStringIncludes } from "#testing/assertions";
import { makeTempDir } from "#testing/temp";

import { outputCommand } from "../utils/command.ts";
import {
	areWorkspacePathsIgnored,
	discardWorkspaceChange,
	findGitRoot,
	findGitWatchPaths,
	parseCommitLog,
	parseNameStatus,
	parsePorcelainStatus,
	readWorkspaceCommit,
	readWorkspaceDiff,
	maximumWorkspaceDiffBytes,
	WorkspaceReviewError,
	readWorkspaceHistory,
	readWorkspaceReview,
	type WorkspaceReviewMetadataCache,
} from "./workspace-review.ts";

test("ignore checks require every path to be ignored and respect tracked files and exceptions", async () => {
	const workspace = await makeTempDir();
	try {
		await git(workspace, "init");
		await Bun.write(`${workspace}/.gitignore`, "*.log\n!important.log\n");
		await Bun.write(`${workspace}/tracked.log`, "tracked\n");
		await git(workspace, "add", "-f", "tracked.log");
		assertEquals(
			await areWorkspacePathsIgnored(workspace, ["a.log", "odd\nname.log"]),
			true,
		);
		assertEquals(
			await areWorkspacePathsIgnored(workspace, ["a.log", "important.log"]),
			false,
		);
		assertEquals(
			await areWorkspacePathsIgnored(workspace, ["a.log", "tracked.log"]),
			false,
		);
		assertEquals(await areWorkspacePathsIgnored(workspace, []), false);
		assertEquals(
			await areWorkspacePathsIgnored(`${workspace}/missing`, ["a.log"]),
			false,
		);
	} finally {
		await rm(workspace, { recursive: true });
	}
});

test("reused metadata preserves content updates and retries an unborn history", async () => {
	const workspace = await makeTempDir();
	const cache: WorkspaceReviewMetadataCache = {};
	try {
		await git(workspace, "init");
		await git(workspace, "config", "user.email", "pi-ui@example.test");
		await git(workspace, "config", "user.name", "pi-ui");
		assertEquals((await readWorkspaceReview(workspace, cache)).commits, []);
		await Bun.write(`${workspace}/file.txt`, "initial\n");
		await git(workspace, "add", ".");
		await git(workspace, "commit", "-m", "initial");
		assertEquals(
			await readWorkspaceReview(workspace, cache),
			await readWorkspaceReview(workspace),
		);
		for (const contents of ["first edit\n", "second edit\n", "initial\n"]) {
			await Bun.write(`${workspace}/file.txt`, contents);
			assertEquals(
				await readWorkspaceReview(workspace, cache),
				await readWorkspaceReview(workspace),
			);
		}
	} finally {
		await rm(workspace, { recursive: true });
	}
});

test("porcelain status parsing keeps rename destinations and status precedence", () => {
	assertEquals(
		parsePorcelainStatus(
			"R  src/new.ts\0src/old.ts\0?? notes.txt\0 D deleted.ts\0AM added.ts\0",
		),
		[
			{ additions: 0, deletions: 0, path: "src/new.ts", status: "renamed" },
			{ additions: 0, deletions: 0, path: "notes.txt", status: "untracked" },
			{ additions: 0, deletions: 0, path: "deleted.ts", status: "deleted" },
			{ additions: 0, deletions: 0, path: "added.ts", status: "added" },
		],
	);
});

test("commit metadata and name-status parsing preserve Git data", () => {
	assertEquals(
		parseCommitLog(
			"0123456789012345678901234567890123456789\x1f0123456\x1fAda\x1f2026-07-20T12:00:00Z\x1ffeat: ship\x1e",
			new Set(["0123456789012345678901234567890123456789"]),
		),
		[
			{
				author: "Ada",
				authoredAt: "2026-07-20T12:00:00Z",
				hash: "0123456789012345678901234567890123456789",
				pushed: false,
				shortHash: "0123456",
				subject: "feat: ship",
			},
		],
	);
	assertEquals(parseNameStatus("M\0README.md\0R100\0old.ts\0new.ts\0"), [
		{ additions: 0, deletions: 0, path: "README.md", status: "modified" },
		{ additions: 0, deletions: 0, path: "new.ts", status: "renamed" },
	]);
});

test("workspace review combines repository files with tracked and untracked changes", async () => {
	const repository = await makeTempDir();
	try {
		await git(repository, "init", "--quiet");
		await git(repository, "config", "user.email", "pi-ui@example.invalid");
		await git(repository, "config", "user.name", "pi-ui test");
		await mkdir(`${repository}/src`);
		await Bun.write(`${repository}/src/old.ts`, "export const old = 1;\n");
		await Bun.write(`${repository}/README.md`, "before\n");
		await git(repository, "add", ".");
		await git(repository, "commit", "--quiet", "-m", "initial");

		await git(repository, "mv", "src/old.ts", "src/new.ts");
		await Bun.write(`${repository}/README.md`, "after\n");
		await Bun.write(`${repository}/notes.txt`, "untracked\n");

		const nestedWorkspace = `${repository}/src`;
		assertEquals(await findGitRoot(nestedWorkspace), repository);
		assertEquals(await findGitWatchPaths(nestedWorkspace), [repository]);
		const snapshot = await readWorkspaceReview(nestedWorkspace);
		assertEquals(snapshot.isGitRepository, true);
		assertEquals(snapshot.changeCount, 3);
		assertEquals(snapshot.commits.length, 1);
		assertEquals(Boolean(snapshot.branch), true);
		assertEquals(snapshot.commits[0].subject, "initial");
		assertEquals(snapshot.commits[0].pushed, null);
		assertEquals((await readWorkspaceHistory(repository, 0)).length, 1);
		const commit = await readWorkspaceCommit(repository, snapshot.commits[0].hash);
		assertEquals(commit?.commit.subject, "initial");
		assertEquals(
			commit?.changes.map(({ path }) => path),
			["README.md", "src/old.ts"],
		);
		assertStringIncludes(commit?.patch ?? "", "diff --git a/README.md b/README.md");
		assertEquals(snapshot.changes, [
			{
				additions: 0,
				deletions: 0,
				path: "src/new.ts",
				status: "renamed",
			},
			{
				additions: 0,
				deletions: 0,
				path: "notes.txt",
				status: "untracked",
			},
			{
				additions: 1,
				deletions: 1,
				path: "README.md",
				status: "modified",
			},
		]);
		assertEquals("patch" in snapshot, false);
		const patch = await readWorkspaceDiff(nestedWorkspace);
		assertStringIncludes(patch, "diff --git a/README.md b/README.md");
		assertStringIncludes(patch, "diff --git a/src/old.ts b/src/new.ts");
		assertStringIncludes(patch, "diff --git a/notes.txt b/notes.txt");
		const renamed = parsePatchFiles(
			await readWorkspaceDiff(repository, "src/new.ts"),
		).flatMap((patch) => patch.files);
		assertEquals(
			renamed.map((file) => file.name),
			["src/new.ts"],
		);
		assertEquals(renamed[0]?.type, "rename-pure");
		assertEquals(snapshot.revision.length, 64);

		await Bun.write(`${repository}/notes.txt`, "changed again\n");
		const updated = await readWorkspaceReview(repository);
		assertEquals(updated.revision, snapshot.revision);
		assertStringIncludes(
			await readWorkspaceDiff(repository, "notes.txt"),
			"+changed again",
		);
	} finally {
		await rm(repository, { recursive: true });
	}
});

for (const committed of [false, true]) {
	test(`${committed ? "commit" : "working-tree"} patches preserve blank context and whitespace`, async () => {
		const repository = await makeTempDir();
		try {
			await git(repository, "init", "--quiet");
			await git(repository, "config", "user.email", "pi-ui@example.invalid");
			await git(repository, "config", "user.name", "pi-ui test");
			await Bun.write(`${repository}/tracked.txt`, "before\n\t \n\n");
			await git(repository, "add", ".");
			await git(repository, "commit", "--quiet", "-m", "initial");
			await Bun.write(`${repository}/tracked.txt`, "after\n\t \n\n");
			await Bun.write(`${repository}/added.txt`, "added\n  \n\t\n");
			if (committed) {
				await git(repository, "add", ".");
				await git(repository, "commit", "--quiet", "-m", "update");
			}
			const snapshot = await readWorkspaceReview(repository);
			const review = committed
				? await readWorkspaceCommit(repository, snapshot.commits[0].hash)
				: { patch: await readWorkspaceDiff(repository) };
			const files = parsePatchFiles(review?.patch ?? "", undefined, true).flatMap(
				(patch) => patch.files,
			);
			assertEquals(files.length, 2);
			assertEquals(
				files.find((file) => file.name === "tracked.txt")?.additionLines,
				["after\n", "\t \n", "\n"],
			);
			assertEquals(files.find((file) => file.name === "added.txt")?.additionLines, [
				"added\n",
				"  \n",
				"\t\n",
			]);
		} finally {
			await rm(repository, { recursive: true });
		}
	});
}

test("large untracked trees stay metadata-only; explicit diffs are bounded and cancellable", async () => {
	const repository = await makeTempDir();
	try {
		await git(repository, "init", "--quiet");
		await Bun.write(
			`${repository}/node_modules/large.js`,
			"x".repeat(maximumWorkspaceDiffBytes * 2),
		);
		await Promise.all(
			Array.from({ length: 120 }, (_, index) =>
				Bun.write(
					`${repository}/node_modules/${index}.js`,
					`export const n = ${index};\n`,
				),
			),
		);
		await Bun.write(`${repository}/[new]\tfile.txt`, "visible new file\n");
		const snapshot = await readWorkspaceReview(repository);
		assertEquals(snapshot.changes.length, 122);
		assertEquals(snapshot.changeCount, 2);
		assertEquals("patch" in snapshot, false);
		assertStringIncludes(
			await readWorkspaceDiff(repository, "[new]\tfile.txt"),
			"+visible new file",
		);
		assertStringIncludes(
			await readWorkspaceDiff(repository, "node_modules/0.js"),
			"+export const n = 0;",
		);
		await assertRejects(
			() => readWorkspaceDiff(repository),
			WorkspaceReviewError,
			"Too many changes",
		);
		await assertRejects(
			() => readWorkspaceDiff(repository, "node_modules/large.js"),
			WorkspaceReviewError,
			"Diff too large",
		);
		await assertRejects(
			() => readWorkspaceDiff(repository, "missing"),
			WorkspaceReviewError,
			"not found",
		);
		await assertRejects(
			() =>
				readWorkspaceDiff(
					repository,
					"node_modules/0.js",
					AbortSignal.abort(new Error("cancelled")),
				),
			Error,
			"cancelled",
		);
		await Bun.write(`${repository}/.gitignore`, "node_modules/\n");
		await git(repository, "add", "-f", "node_modules/0.js");
		assertEquals(
			(await readWorkspaceReview(repository)).changes
				.map((file) => file.path)
				.sort(),
			[".gitignore", "[new]\tfile.txt", "node_modules/0.js"],
		);
	} finally {
		await rm(repository, { recursive: true });
	}
});

test("workspace review discards one tracked or untracked file at a time", async () => {
	const repository = await makeTempDir();
	try {
		await git(repository, "init", "--quiet");
		await git(repository, "config", "user.email", "pi-ui@example.invalid");
		await git(repository, "config", "user.name", "pi-ui test");
		await Bun.write(`${repository}/keep.txt`, "before\n");
		await Bun.write(`${repository}/old.txt`, "rename me\n");
		await git(repository, "add", ".");
		await git(repository, "commit", "--quiet", "-m", "initial");

		await Bun.write(`${repository}/keep.txt`, "after\n");
		await Bun.write(`${repository}/untracked.txt`, "temporary\n");
		await git(repository, "mv", "old.txt", "new.txt");

		await discardWorkspaceChange(repository, "new.txt");
		assertEquals(await Bun.file(`${repository}/old.txt`).text(), "rename me\n");
		await assertRejects(() => stat(`${repository}/new.txt`));
		assertEquals(
			(await readWorkspaceReview(repository)).changes.map(({ path }) => path),
			["keep.txt", "untracked.txt"],
		);

		await discardWorkspaceChange(repository, "untracked.txt");
		await assertRejects(() => stat(`${repository}/untracked.txt`));
		await discardWorkspaceChange(repository, "keep.txt");
		assertEquals(await Bun.file(`${repository}/keep.txt`).text(), "before\n");
		assertEquals((await readWorkspaceReview(repository)).changes, []);
	} finally {
		await rm(repository, { recursive: true });
	}
});

test("workspace review reports non-repositories without throwing", async () => {
	const workspace = await makeTempDir();
	try {
		const snapshot = await readWorkspaceReview(workspace);
		assertEquals(snapshot.isGitRepository, false);
		assertEquals(snapshot.changes, []);
		assertEquals(snapshot.commits, []);
		assertEquals("patch" in snapshot, false);
		assertEquals(snapshot.revision, "non-git");
	} finally {
		await rm(workspace, { recursive: true });
	}
});

async function git(cwd: string, ...args: string[]): Promise<void> {
	const output = await outputCommand("git", {
		args: ["-C", cwd, ...args],
	});
	if (!output.success) {
		throw new Error(new TextDecoder().decode(output.stderr));
	}
}
