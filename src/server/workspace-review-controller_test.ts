import { test } from "bun:test";

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
		await new Promise((resolve) => setTimeout(resolve, 50));
		await writeTextFile(`${workspace}/example.txt`, "second\n");
		await waitFor(() => store.workspaceReview.revision !== revision);
		await waitFor(() => store.workspaceFilesRevision !== filesRevision);

		assertEquals(store.workspaceReview.changes[0]?.path, "example.txt");
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
