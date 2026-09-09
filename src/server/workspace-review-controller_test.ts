import { test } from "bun:test";
import { rename, rm } from "node:fs/promises";

import { assertEquals } from "#testing/assertions";
import { makeTempDir } from "#testing/temp";

import { AppStore } from "../state/app-store.ts";
import { outputCommand } from "../utils/command.ts";
import { WorkspaceReviewController } from "./workspace-review-controller.ts";

test.concurrent("workspace review controller publishes Git changes to AppStore", async () => {
	const workspace = await makeTempDir();
	const store = new AppStore();
	const controller = new WorkspaceReviewController(store);
	try {
		await git(workspace, "init");
		await git(workspace, "config", "user.email", "pi-ui@example.test");
		await git(workspace, "config", "user.name", "pi-ui");
		await Bun.write(`${workspace}/example.txt`, "first\n");
		await git(workspace, "add", "example.txt");
		await git(workspace, "commit", "-m", "initial");

		await controller.open(workspace);
		assertEquals(store.workspaceReview.isGitRepository, true);
		const revision = store.workspaceReview.revision;
		const filesRevision = store.workspaceFilesRevision;
		const treeRevision = store.workspaceTreeRevision;
		await Bun.write(`${workspace}/example.txt`, "second\n");
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
		await rm(workspace, { recursive: true });
	}
});

test.concurrent("ignored writes still notify the file browser; mixed writes and ignore rules refresh Git", async () => {
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
		await Bun.write(`${workspace}/.gitignore`, "*.log\n");
		await Bun.write(`${workspace}/tracked.log`, "initial\n");
		await Bun.write(`${workspace}/ignored.log`, "initial\n");
		await git(workspace, "add", ".gitignore");
		await git(workspace, "add", "-f", "tracked.log");
		await git(workspace, "commit", "-m", "initial");
		await controller.open(workspace);
		assertEquals(store.workspaceReview.commits.length, 1);
		const refreshes = store.refreshes;
		const filesRevision = store.workspaceFilesRevision;
		await Bun.write(`${workspace}/ignored.log`, "ignored edit\n");
		await waitFor(() => store.workspaceFilesRevision > filesRevision);
		await new Promise((resolve) => setTimeout(resolve, 300));
		assertEquals(store.refreshes, refreshes);
		await Bun.write(`${workspace}/ignored.log`, "mixed edit\n");
		await Bun.write(`${workspace}/tracked.log`, "tracked edit\n");
		await waitFor(() =>
			store.workspaceReview.changes.some(({ path }) => path === "tracked.log"),
		);
		await Bun.write(`${workspace}/.gitignore`, "*.log\n!ignored.log\n");
		await waitFor(() =>
			store.workspaceReview.changes.some(({ path }) => path === "ignored.log"),
		);
	} finally {
		controller.dispose();
		await rm(workspace, { recursive: true });
	}
});

for (const linkedWorktree of [false, true]) {
	test.concurrent(`workspace watcher ignores Git internals but observes commits (${linkedWorktree ? "linked worktree" : "repository"})`, async () => {
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
			await controller.open(workspace);
			assertEquals(store.workspaceReview.commits.length, 1);
			const filesRevision = store.workspaceFilesRevision;
			await Bun.write(`${repository}/.git/objects/pack/noise.tmp`, "noise");
			await Bun.write(`${repository}/.git/logs/noise`, "noise");
			await Bun.write(`${repository}/.git/index.lock`, "noise");
			await new Promise((resolve) => setTimeout(resolve, 500));
			assertEquals(store.workspaceFilesRevision, filesRevision);
			await rm(`${repository}/.git/index.lock`);

			// A worktree file named like Git metadata must not be filtered.
			await Bun.write(`${workspace}/output.lock`, "content");
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
			if (linkedWorktree) await rm(workspace, { recursive: true });
			await rm(repository, { recursive: true });
		}
	});
}

test.concurrent("tree revisions preserve structural changes across later content edits", async () => {
	const workspace = await makeTempDir();
	const store = new AppStore();
	const controller = new WorkspaceReviewController(store);
	try {
		await Bun.write(`${workspace}/existing.txt`, "initial");
		await controller.open(workspace);
		assertEquals(store.workspaceReview.revision, "non-git");

		const treeRevision = store.workspaceTreeRevision;
		await Bun.write(`${workspace}/existing.txt`, "edited");
		await waitFor(() => store.workspaceFilesRevision > 0);
		assertEquals(store.workspaceTreeRevision, treeRevision);

		for (const mutate of [
			() => Bun.write(`${workspace}/created.txt`, "created"),
			() => rename(`${workspace}/created.txt`, `${workspace}/renamed.txt`),
			() => rm(`${workspace}/renamed.txt`),
		]) {
			const before = store.workspaceTreeRevision;
			await mutate();
			await Bun.write(`${workspace}/existing.txt`, String(before));
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
		await rm(workspace, { recursive: true });
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
