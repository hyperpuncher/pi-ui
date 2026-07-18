import { assertEquals, assertStringIncludes } from "@std/assert";

import {
	findGitRoot,
	parsePorcelainStatus,
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
		const snapshot = await readWorkspaceReview(nestedWorkspace);
		assertEquals(snapshot.isGitRepository, true);
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
		assertEquals(snapshot.patch, "");
		assertEquals(snapshot.revision, "non-git");
	} finally {
		await Deno.remove(workspace, { recursive: true });
	}
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
