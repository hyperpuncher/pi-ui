import { expect, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";

import { makeTempDir } from "#testing/temp";

import { outputCommand } from "../utils/command.ts";
import {
	createGitBranch,
	createGitWorktree,
	deleteGitBranch,
	findGitProjectRoot,
	GitWorktreeError,
	ignoredWorktreePaths,
	inspectGitWorktrees,
	removeGitWorktree,
	switchGitBranch,
	worktreeSessionPath,
} from "./git-worktrees.ts";

type Repository = Readonly<{ repository: string; worktreeRoot: string }>;

test("Git worktrees are discovered", async () => {
	await withRepository(async ({ repository }) => {
		const initial = await inspectGitWorktrees(repository);
		expect(initial?.currentBranch).toBe("main");
		expect(initial?.projectRoot).toBe(repository);
		expect(await findGitProjectRoot(repository)).toBe(repository);
		expect(initial?.branches).toContainEqual({
			label: "main",
			ref: "refs/heads/main",
			worktreePath: repository,
		});
		expect(initial?.worktrees).toHaveLength(1);
	});
});

test("Git worktrees are created with the requested branch name", async () => {
	await withRepository(async ({ repository, worktreeRoot }) => {
		const created = await createGitWorktree(
			repository,
			"feature/plain-name",
			"refs/heads/main",
			worktreeRoot,
		);
		expect(created.branch).toBe("feature/plain-name");
		expect(created.path.startsWith(worktreeRoot)).toBe(true);
		expect(created.path).toContain("feature~plain-name-");

		const linked = await inspectGitWorktrees(created.path);
		expect(linked?.currentBranch).toBe("feature/plain-name");
		expect(linked?.worktrees.find((worktree) => worktree.current)?.path).toBe(
			created.path,
		);

		const fromMain = await inspectGitWorktrees(repository);
		expect(fromMain?.worktrees).toHaveLength(2);
		expect(
			fromMain?.worktrees.find(
				(worktree) => worktree.branch === "feature/plain-name",
			)?.path,
		).toBe(created.path);

		await removeGitWorktree(created.projectRoot, created.path);
		const after = await inspectGitWorktrees(repository);
		expect(after?.worktrees).toHaveLength(1);
		expect(
			after?.branches.some(
				(branch) => branch.ref === "refs/heads/feature/plain-name",
			),
		).toBe(true);
	});
});

test("Git worktree sessions keep a repository subdirectory selected", async () => {
	await withRepository(
		async ({ repository, worktreeRoot }) => {
			const nested = `${repository}/packages/web`;
			const fromNested = await inspectGitWorktrees(nested);
			expect(fromNested?.workspaceRelative).toBe("packages/web");
			expect(fromNested?.projectRoot).toBe(repository);

			const created = await createGitWorktree(
				nested,
				"feature/nested",
				"refs/heads/main",
				worktreeRoot,
			);
			expect(created.sessionPath).toBe(`${created.path}/packages/web`);

			const linked = await inspectGitWorktrees(created.sessionPath);
			expect(linked?.workspaceRelative).toBe("packages/web");
			for (const worktree of linked?.worktrees ?? [])
				expect(worktree.sessionPath).toBe(`${worktree.path}/packages/web`);

			expect(await worktreeSessionPath(created.path, "missing/dir")).toBe(
				created.path,
			);
			await removeGitWorktree(created.projectRoot, created.path);
		},
		["packages/web/README.md", "web\n"],
	);
});

test("Git worktree inspection reports non-repositories", async () => {
	const directory = await makeTempDir({ prefix: "pi-ui-not-a-repository-" });
	try {
		expect(await inspectGitWorktrees(directory)).toBeUndefined();
		expect(await findGitProjectRoot(directory)).toBeUndefined();
	} finally {
		await rm(directory, { recursive: true, force: true });
	}
});

test("Git worktrees support repositories without a first commit", async () => {
	await withRepository(async ({ repository, worktreeRoot }) => {
		const created = await createGitWorktree(
			repository,
			"first-task",
			"HEAD",
			worktreeRoot,
		);
		expect((await inspectGitWorktrees(created.path))?.currentBranch).toBe(
			"first-task",
		);
		await removeGitWorktree(created.projectRoot, created.path);
	}, null);
});

test("Git worktree creation rejects invalid branch names and base refs", async () => {
	await withRepository(async ({ repository, worktreeRoot }) => {
		await expect(
			createGitWorktree(repository, "bad branch", "refs/heads/main", worktreeRoot),
		).rejects.toBeInstanceOf(GitWorktreeError);
		await expect(
			createGitWorktree(repository, "feature/test", "missing", worktreeRoot),
		).rejects.toThrow("Choose an available base branch.");
	});
});

test("Git worktree removal keeps branches for external and missing checkouts", async () => {
	await withRepository(async ({ repository, worktreeRoot }) => {
		const external = join(worktreeRoot, "external");
		await runGit(repository, ["worktree", "add", "-b", "external-branch", external]);
		await removeGitWorktree(repository, external);
		const afterExternal = await inspectGitWorktrees(repository);
		expect(afterExternal?.worktrees).toHaveLength(1);
		expect(
			afterExternal?.branches.some((branch) => branch.label === "external-branch"),
		).toBe(true);

		const missing = join(worktreeRoot, "missing");
		await runGit(repository, ["worktree", "add", "-b", "missing-branch", missing]);
		await rm(missing, { recursive: true, force: true });
		await removeGitWorktree(repository, missing);
		const afterMissing = await inspectGitWorktrees(repository);
		expect(afterMissing?.worktrees).toHaveLength(1);
		expect(
			afterMissing?.branches.some((branch) => branch.label === "missing-branch"),
		).toBe(true);
	});
});

test("Git worktree removal refuses changes and retains unmerged commits", async () => {
	await withRepository(
		async ({ repository, worktreeRoot }) => {
			const created = await createGitWorktree(
				repository,
				"feature/preserved",
				"refs/heads/main",
				worktreeRoot,
			);
			await Bun.write(`${created.path}/README.md`, "modified\n");
			await expect(
				removeGitWorktree(repository, created.path),
			).rejects.toBeInstanceOf(GitWorktreeError);
			expect(await Bun.file(`${created.path}/README.md`).text()).toBe("modified\n");

			await Bun.write(`${created.path}/README.md`, "initial\n");
			await Bun.write(`${created.path}/untracked.txt`, "keep me\n");
			await expect(
				removeGitWorktree(repository, created.path),
			).rejects.toBeInstanceOf(GitWorktreeError);
			expect(await Bun.file(`${created.path}/untracked.txt`).text()).toBe(
				"keep me\n",
			);

			await rm(`${created.path}/untracked.txt`);
			await Bun.write(`${created.path}/README.md`, "committed\n");
			await runGit(created.path, ["add", "README.md"]);
			await runGit(created.path, ["commit", "-m", "branch work"]);
			await removeGitWorktree(repository, created.path);
			await runGit(repository, [
				"show-ref",
				"--verify",
				"refs/heads/feature/preserved",
			]);
		},
		["README.md", "initial\n"],
	);
});

test("Git worktree removal requires consent to the current ignored paths", async () => {
	await withRepository(
		async ({ repository, worktreeRoot }) => {
			const created = await createGitWorktree(
				repository,
				"feature/ignored",
				"refs/heads/main",
				worktreeRoot,
			);
			await Bun.write(`${created.path}/ignored/file`, "secret\n");
			const inspected = await ignoredWorktreePaths(created.path);
			expect(inspected.paths).toEqual(["ignored/"]);
			await expect(removeGitWorktree(repository, created.path)).rejects.toThrow(
				"Review ignored files",
			);
			await Bun.write(`${created.path}/new.secret`, "new\n");
			await expect(
				removeGitWorktree(repository, created.path, inspected.revision),
			).rejects.toThrow("Ignored files changed");
			expect(await Bun.file(`${created.path}/new.secret`).text()).toBe("new\n");

			const refreshed = await ignoredWorktreePaths(created.path);
			expect(refreshed.paths).toEqual(["ignored/", "new.secret"]);
			await removeGitWorktree(repository, created.path, refreshed.revision);
			expect(await Bun.file(`${created.path}/new.secret`).exists()).toBe(false);
			await runGit(repository, [
				"show-ref",
				"--verify",
				"refs/heads/feature/ignored",
			]);
		},
		[".gitignore", "ignored/\n*.secret\n"],
	);
});

test("Git branches switch inside the current checkout", async () => {
	await withRepository(async ({ repository }) => {
		await runGit(repository, ["branch", "feature/switch"]);
		await switchGitBranch(repository, "feature/switch");
		expect((await inspectGitWorktrees(repository))?.currentBranch).toBe(
			"feature/switch",
		);
		await expect(switchGitBranch(repository, "missing")).rejects.toBeInstanceOf(
			GitWorktreeError,
		);
	});
});

test("Git branches are created from the current checkout", async () => {
	await withRepository(async ({ repository }) => {
		await createGitBranch(repository, "feature/created");
		const mentioned = await inspectGitWorktrees(repository);
		expect(mentioned?.currentBranch).toBe("feature/created");
		expect(
			mentioned?.branches.some((branch) => branch.label === "feature/created"),
		).toBe(true);

		await expect(createGitBranch(repository, "bad branch")).rejects.toBeInstanceOf(
			GitWorktreeError,
		);
		await expect(
			createGitBranch(repository, "feature/created"),
		).rejects.toBeInstanceOf(GitWorktreeError);
	});
});

test("Git branches are deleted from the current checkout", async () => {
	await withRepository(async ({ repository }) => {
		await runGit(repository, ["branch", "feature/gone"]);
		await deleteGitBranch(repository, "feature/gone");
		expect(
			(await inspectGitWorktrees(repository))?.branches.some(
				(branch) => branch.label === "feature/gone",
			),
		).toBe(false);
		await expect(deleteGitBranch(repository, "main")).rejects.toBeInstanceOf(
			GitWorktreeError,
		);
		await expect(deleteGitBranch(repository, "missing")).rejects.toBeInstanceOf(
			GitWorktreeError,
		);
	});
});

async function withRepository(
	run: (fixture: Repository) => Promise<void>,
	initialFile: readonly [string, string] | null = ["README.md", "test\n"],
): Promise<void> {
	const repository = await makeTempDir({ prefix: "pi-ui-worktree-repository-" });
	const worktreeRoot = await makeTempDir({ prefix: "pi-ui-worktrees-" });
	try {
		await runGit(repository, ["init", "-b", "main"]);
		if (initialFile) {
			await Bun.write(`${repository}/${initialFile[0]}`, initialFile[1]);
			await runGit(repository, ["add", "."]);
			await runGit(repository, ["commit", "-m", "initial"]);
		}
		await run({ repository, worktreeRoot });
	} finally {
		await Promise.all(
			[repository, worktreeRoot].map((path) =>
				rm(path, { recursive: true, force: true }),
			),
		);
	}
}

async function runGit(cwd: string, args: string[]): Promise<void> {
	const result = await outputCommand("git", {
		args,
		cwd,
		env: {
			GIT_AUTHOR_EMAIL: "test@example.com",
			GIT_AUTHOR_NAME: "Test",
			GIT_COMMITTER_EMAIL: "test@example.com",
			GIT_COMMITTER_NAME: "Test",
		},
	});
	if (!result.success) throw new Error(new TextDecoder().decode(result.stderr));
}
