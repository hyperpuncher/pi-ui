import { assertEquals, assertStringIncludes } from "@std/assert";

import {
	findGitRoot,
	findGitWatchPaths,
	parseCommitLog,
	parseNameStatus,
	parsePorcelainStatus,
	readWorkspaceCommit,
	readWorkspaceHistory,
	readWorkspaceReview,
} from "./workspace-review.ts";

Deno.test("porcelain status parsing keeps rename destinations and status precedence", () => {
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

Deno.test("commit metadata and name-status parsing preserve Git data", () => {
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

Deno.test("workspace review combines repository files with tracked and untracked changes", async () => {
	const repository = await Deno.makeTempDir();
	try {
		await git(repository, "init", "--quiet");
		await git(repository, "config", "user.email", "pi-ui@example.invalid");
		await git(repository, "config", "user.name", "pi-ui test");
		await Deno.mkdir(`${repository}/src`);
		await Deno.writeTextFile(`${repository}/src/old.ts`, "export const old = 1;\n");
		await Deno.writeTextFile(`${repository}/README.md`, "before\n");
		await git(repository, "add", ".");
		await git(repository, "commit", "--quiet", "-m", "initial");

		await git(repository, "mv", "src/old.ts", "src/new.ts");
		await Deno.writeTextFile(`${repository}/README.md`, "after\n");
		await Deno.writeTextFile(`${repository}/notes.txt`, "untracked\n");

		const nestedWorkspace = `${repository}/src`;
		assertEquals(await findGitRoot(nestedWorkspace), repository);
		assertEquals(await findGitWatchPaths(nestedWorkspace), [repository]);
		const snapshot = await readWorkspaceReview(nestedWorkspace);
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
			{
				additions: 0,
				deletions: 0,
				path: "src/new.ts",
				status: "renamed",
			},
		]);
		assertStringIncludes(snapshot.patch, "diff --git a/README.md b/README.md");
		assertStringIncludes(snapshot.patch, "diff --git a/src/old.ts b/src/new.ts");
		assertStringIncludes(snapshot.patch, "diff --git a/notes.txt b/notes.txt");
		assertEquals(snapshot.revision.length, 64);

		await Deno.writeTextFile(`${repository}/notes.txt`, "changed again\n");
		const updated = await readWorkspaceReview(repository);
		assertEquals(updated.revision === snapshot.revision, false);
	} finally {
		await Deno.remove(repository, { recursive: true });
	}
});

Deno.test("workspace review reports non-repositories without throwing", async () => {
	const workspace = await Deno.makeTempDir();
	try {
		const snapshot = await readWorkspaceReview(workspace);
		assertEquals(snapshot.isGitRepository, false);
		assertEquals(snapshot.changes, []);
		assertEquals(snapshot.commits, []);
		assertEquals(snapshot.patch, "");
		assertEquals(snapshot.revision, "non-git");
	} finally {
		await Deno.remove(workspace, { recursive: true });
	}
});

Deno.test("workspace review is unavailable when Git is not installed", async () => {
	const moduleUrl = new URL("./workspace-review.ts", import.meta.url).href;
	const script = `
		const { readWorkspaceReview } = await import(${JSON.stringify(moduleUrl)});
		console.log(JSON.stringify(await readWorkspaceReview(Deno.cwd())));
	`;
	const output = await new Deno.Command(Deno.execPath(), {
		args: ["eval", "--conditions=browser", script],
		env: { ...Deno.env.toObject(), PATH: "" },
		stderr: "piped",
		stdout: "piped",
	}).output();
	assertEquals(output.success, true, new TextDecoder().decode(output.stderr));
	assertEquals(JSON.parse(new TextDecoder().decode(output.stdout)), {
		branch: null,
		changes: [],
		commits: [],
		isGitRepository: false,
		patch: "",
		revision: "non-git",
	});
});

async function git(cwd: string, ...args: string[]): Promise<void> {
	const output = await new Deno.Command("git", {
		args: ["-C", cwd, ...args],
		stderr: "piped",
		stdout: "piped",
	}).output();
	if (!output.success) {
		throw new Error(new TextDecoder().decode(output.stderr));
	}
}
