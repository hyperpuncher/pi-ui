import { test } from "bun:test";
import { rename } from "node:fs/promises";

import { assertEquals } from "#testing/assertions";
import { remove, writeTextFile } from "#testing/files";
import { makeTempDir } from "#testing/temp";

import { AppStore } from "../state/app-store.ts";
import { outputCommand } from "../utils/command.ts";
import { WorkspaceReviewController } from "./workspace-review-controller.ts";

test("workspace review controller publishes Git changes to AppStore", async () => {
	const workspace = await makeTempDir();
	const store = new AppStore();
	const controller = new WorkspaceReviewController(store);
	try {
		await git(workspace, "init");
		await git(workspace, "config", "user.email", "pi-ui@example.test");
		await git(workspace, "config", "user.name", "pi-ui");
		await writeTextFile(`${workspace}/example.txt`, "first\n");
		await git(workspace, "add", "example.txt");
		await git(workspace, "commit", "-m", "initial");

		controller.open(workspace);
		await waitFor(() => store.workspaceReview.isGitRepository);
		const revision = store.workspaceReview.revision;
		const filesRevision = store.workspaceFilesRevision;
		const treeRevision = store.workspaceTreeRevision;
		await new Promise((resolve) => setTimeout(resolve, 50));
		await writeTextFile(`${workspace}/example.txt`, "second\n");
		await waitFor(() => store.workspaceReview.revision !== revision);
		await waitFor(() => store.workspaceFilesRevision !== filesRevision);

		assertEquals(store.workspaceReview.changes[0]?.path, "example.txt");
		assertEquals(store.workspaceTreeRevision, treeRevision);
		await new Promise((resolve) => setTimeout(resolve, 300));
		const settledFilesRevision = store.workspaceFilesRevision;
		await new Promise((resolve) => setTimeout(resolve, 300));
		assertEquals(store.workspaceFilesRevision, settledFilesRevision);
	} finally {
		controller.dispose();
		await remove(workspace, { recursive: true });
	}
});

test("workspace review controller publishes non-Git file changes", async () => {
	const workspace = await makeTempDir();
	const store = new AppStore();
	const controller = new WorkspaceReviewController(store);
	try {
		controller.open(workspace);
		await waitFor(() => store.workspaceReview.revision === "non-git");
		const revision = store.workspaceFilesRevision;
		await writeTextFile(`${workspace}/example.txt`, "first\n");
		await waitFor(() => store.workspaceFilesRevision !== revision);
	} finally {
		controller.dispose();
		await remove(workspace, { recursive: true });
	}
});

test("ignored writes still notify the file browser; mixed writes and ignore rules refresh Git", async () => {
	const workspace = await makeTempDir();
	class MeasuredStore extends AppStore {
		refreshes = 0;
		override setWorkspaceReview(
			snapshot: Parameters<AppStore["setWorkspaceReview"]>[0],
		) {
			this.refreshes++;
			super.setWorkspaceReview(snapshot);
		}
	}
	const store = new MeasuredStore();
	const controller = new WorkspaceReviewController(store);
	try {
		await git(workspace, "init");
		await git(workspace, "config", "user.email", "pi-ui@example.test");
		await git(workspace, "config", "user.name", "pi-ui");
		await writeTextFile(`${workspace}/.gitignore`, "*.log\n");
		await writeTextFile(`${workspace}/tracked.log`, "initial\n");
		await writeTextFile(`${workspace}/ignored.log`, "initial\n");
		await git(workspace, "add", ".gitignore");
		await git(workspace, "add", "-f", "tracked.log");
		await git(workspace, "commit", "-m", "initial");
		controller.open(workspace);
		await waitFor(() => store.workspaceReview.commits.length === 1);
		await new Promise((resolve) => setTimeout(resolve, 100));
		const refreshes = store.refreshes;
		const filesRevision = store.workspaceFilesRevision;
		await writeTextFile(`${workspace}/ignored.log`, "ignored edit\n");
		await waitFor(() => store.workspaceFilesRevision > filesRevision);
		await new Promise((resolve) => setTimeout(resolve, 300));
		assertEquals(store.refreshes, refreshes);
		await writeTextFile(`${workspace}/ignored.log`, "mixed edit\n");
		await writeTextFile(`${workspace}/tracked.log`, "tracked edit\n");
		await waitFor(() =>
			store.workspaceReview.changes.some(({ path }) => path === "tracked.log"),
		);
		await writeTextFile(`${workspace}/.gitignore`, "*.log\n!ignored.log\n");
		await waitFor(() =>
			store.workspaceReview.changes.some(({ path }) => path === "ignored.log"),
		);
	} finally {
		controller.dispose();
		await remove(workspace, { recursive: true });
	}
});

for (const linkedWorktree of [false, true]) {
	test(`workspace watcher ignores Git internals but observes commits (${linkedWorktree ? "linked worktree" : "repository"})`, async () => {
		const repository = await makeTempDir();
		const workspace = linkedWorktree ? await makeTempDir() : repository;
		const store = new AppStore();
		const controller = new WorkspaceReviewController(store);
		try {
			await git(repository, "init");
			await git(repository, "config", "user.email", "pi-ui@example.test");
			await git(repository, "config", "user.name", "pi-ui");
			await git(repository, "commit", "--allow-empty", "-m", "initial");
			if (linkedWorktree)
				await git(repository, "worktree", "add", "-b", "linked", workspace);
			controller.open(workspace);
			await waitFor(() => store.workspaceReview.commits.length === 1);
			await new Promise((resolve) => setTimeout(resolve, 100));
			const filesRevision = store.workspaceFilesRevision;
			await writeTextFile(`${repository}/.git/objects/pack/noise.tmp`, "noise");
			await writeTextFile(`${repository}/.git/logs/noise`, "noise");
			await writeTextFile(`${repository}/.git/index.lock`, "noise");
			await new Promise((resolve) => setTimeout(resolve, 500));
			assertEquals(store.workspaceFilesRevision, filesRevision);
			await remove(`${repository}/.git/index.lock`);

			// A worktree file named like Git metadata must not be filtered.
			await writeTextFile(`${workspace}/output.lock`, "content");
			await waitFor(() =>
				store.workspaceReview.changes.some(({ path }) => path === "output.lock"),
			);
			await git(workspace, "commit", "--allow-empty", "-m", "next");
			await waitFor(() => store.workspaceReview.commits.length === 2);
			await git(workspace, "checkout", "-b", "switched");
			await waitFor(() => store.workspaceReview.branch === "switched");
			await git(workspace, "checkout", "--detach", "HEAD");
			await waitFor(
				() => store.workspaceReview.branch?.startsWith("detached@") === true,
			);
		} finally {
			controller.dispose();
			if (linkedWorktree) await remove(workspace, { recursive: true });
			await remove(repository, { recursive: true });
		}
	});
}

test("tree revisions preserve structural changes across later content edits", async () => {
	const workspace = await makeTempDir();
	const store = new AppStore();
	const controller = new WorkspaceReviewController(store);
	try {
		await writeTextFile(`${workspace}/existing.txt`, "initial");
		controller.open(workspace);
		await waitFor(() => store.workspaceReview.revision === "non-git");
		await new Promise((resolve) => setTimeout(resolve, 100));

		const treeRevision = store.workspaceTreeRevision;
		await writeTextFile(`${workspace}/existing.txt`, "edited");
		await waitFor(() => store.workspaceFilesRevision > 0);
		assertEquals(store.workspaceTreeRevision, treeRevision);

		for (const mutate of [
			() => writeTextFile(`${workspace}/created.txt`, "created"),
			() => rename(`${workspace}/created.txt`, `${workspace}/renamed.txt`),
			() => remove(`${workspace}/renamed.txt`),
		]) {
			const before = store.workspaceTreeRevision;
			await mutate();
			await writeTextFile(`${workspace}/existing.txt`, String(before));
			await waitFor(() => store.workspaceTreeRevision > before);
			assertEquals(
				store.snapshot().workspaceTreeRevision,
				store.workspaceTreeRevision,
			);
		}
		store.setWorkspacePath(`${workspace}/other`);
		assertEquals(store.workspaceTreeRevision, 0);
		assertEquals(store.workspaceFilesRevision, 0);
	} finally {
		controller.dispose();
		await remove(workspace, { recursive: true });
	}
});

async function git(cwd: string, ...args: string[]): Promise<void> {
	const output = await outputCommand("git", {
		args: ["-C", cwd, ...args],
	});
	if (!output.success) throw new Error(new TextDecoder().decode(output.stderr));
}

async function waitFor(predicate: () => boolean): Promise<void> {
	const deadline = Date.now() + 5_000;
	while (!predicate()) {
		if (Date.now() >= deadline) throw new Error("Timed out waiting for Git state");
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
}
