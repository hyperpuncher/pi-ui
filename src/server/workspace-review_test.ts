import { test } from "bun:test";

import { assertEquals, assertRejects, assertStringIncludes } from "#testing/assertions";
import { mkdir, readTextFile, remove, stat, writeTextFile } from "#testing/files";
import { makeTempDir } from "#testing/temp";

import { outputCommand } from "../utils/command.ts";
import type { WorkspaceReviewSnapshot } from "../workspace-review-types.ts";
import {
	areWorkspacePathsIgnored,
	discardWorkspaceChange,
	findGitRoot,
	findGitWatchPaths,
	parseCommitLog,
	parseNameStatus,
	parsePorcelainStatus,
	readWorkspaceCommit,
	readWorkspaceHistory,
	readWorkspaceReview,
} from "./workspace-review.ts";

test("ignore checks require every path to be ignored and respect tracked files and exceptions", async () => {
	const workspace = await makeTempDir();
	try {
		await git(workspace, "init");
		await writeTextFile(`${workspace}/.gitignore`, "*.log\n!important.log\n");
		await writeTextFile(`${workspace}/tracked.log`, "tracked\n");
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
		await remove(workspace, { recursive: true });
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
		await writeTextFile(`${repository}/src/old.ts`, "export const old = 1;\n");
		await writeTextFile(`${repository}/README.md`, "before\n");
		await git(repository, "add", ".");
		await git(repository, "commit", "--quiet", "-m", "initial");

		await git(repository, "mv", "src/old.ts", "src/new.ts");
		await writeTextFile(`${repository}/README.md`, "after\n");
		await writeTextFile(`${repository}/notes.txt`, "untracked\n");

		const nestedWorkspace = `${repository}/src`;
		assertEquals(await findGitRoot(nestedWorkspace), repository);
		assertEquals(await findGitWatchPaths(nestedWorkspace), [repository]);
		let summary: WorkspaceReviewSnapshot | undefined;
		const snapshot = await readWorkspaceReview(nestedWorkspace, (value) => {
			summary = value;
		});
		assertEquals(summary?.commits.length, 1);
		assertEquals(summary?.patch, "");
		assertEquals(summary?.revision.startsWith("git-summary:"), true);
		assertEquals(snapshot.isGitRepository, true);
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
				additions: 1,
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
		assertStringIncludes(snapshot.patch, "diff --git a/README.md b/README.md");
		assertStringIncludes(snapshot.patch, "diff --git a/src/old.ts b/src/new.ts");
		assertStringIncludes(snapshot.patch, "diff --git a/notes.txt b/notes.txt");
		assertEquals(snapshot.revision.length, 64);

		await writeTextFile(`${repository}/notes.txt`, "changed again\n");
		const updated = await readWorkspaceReview(repository);
		assertEquals(updated.revision === snapshot.revision, false);
	} finally {
		await remove(repository, { recursive: true });
	}
});

test("workspace review discards one tracked or untracked file at a time", async () => {
	const repository = await makeTempDir();
	try {
		await git(repository, "init", "--quiet");
		await git(repository, "config", "user.email", "pi-ui@example.invalid");
		await git(repository, "config", "user.name", "pi-ui test");
		await writeTextFile(`${repository}/keep.txt`, "before\n");
		await writeTextFile(`${repository}/old.txt`, "rename me\n");
		await git(repository, "add", ".");
		await git(repository, "commit", "--quiet", "-m", "initial");

		await writeTextFile(`${repository}/keep.txt`, "after\n");
		await writeTextFile(`${repository}/untracked.txt`, "temporary\n");
		await git(repository, "mv", "old.txt", "new.txt");

		await discardWorkspaceChange(repository, "new.txt");
		assertEquals(await readTextFile(`${repository}/old.txt`), "rename me\n");
		await assertRejects(() => stat(`${repository}/new.txt`));
		assertEquals(
			(await readWorkspaceReview(repository)).changes.map(({ path }) => path),
			["keep.txt", "untracked.txt"],
		);

		await discardWorkspaceChange(repository, "untracked.txt");
		await assertRejects(() => stat(`${repository}/untracked.txt`));
		await discardWorkspaceChange(repository, "keep.txt");
		assertEquals(await readTextFile(`${repository}/keep.txt`), "before\n");
		assertEquals((await readWorkspaceReview(repository)).changes, []);
	} finally {
		await remove(repository, { recursive: true });
	}
});

test("workspace review reports non-repositories without throwing", async () => {
	const workspace = await makeTempDir();
	try {
		const snapshot = await readWorkspaceReview(workspace);
		assertEquals(snapshot.isGitRepository, false);
		assertEquals(snapshot.changes, []);
		assertEquals(snapshot.commits, []);
		assertEquals(snapshot.patch, "");
		assertEquals(snapshot.revision, "non-git");
	} finally {
		await remove(workspace, { recursive: true });
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
