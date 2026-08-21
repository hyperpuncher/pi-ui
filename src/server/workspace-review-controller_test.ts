import { assertEquals } from "@std/assert";

import { AppStore } from "../state/app-store.ts";
import { WorkspaceReviewController } from "./workspace-review-controller.ts";

Deno.test("workspace review controller publishes Git changes to AppStore", async () => {
	const workspace = await Deno.makeTempDir();
	const store = new AppStore();
	const controller = new WorkspaceReviewController(store);
	try {
		await git(workspace, "init");
		await git(workspace, "config", "user.email", "pi-ui@example.test");
		await git(workspace, "config", "user.name", "pi-ui");
		await Deno.writeTextFile(`${workspace}/example.txt`, "first\n");
		await git(workspace, "add", "example.txt");
		await git(workspace, "commit", "-m", "initial");

		controller.open(workspace);
		await waitFor(() => store.workspaceReview.isGitRepository);
		const revision = store.workspaceReview.revision;
		await new Promise((resolve) => setTimeout(resolve, 50));
		await Deno.writeTextFile(`${workspace}/example.txt`, "second\n");
		await waitFor(() => store.workspaceReview.revision !== revision);

		assertEquals(store.workspaceReview.changes[0]?.path, "example.txt");
	} finally {
		controller.dispose();
		await Deno.remove(workspace, { recursive: true });
	}
});

async function git(cwd: string, ...args: string[]): Promise<void> {
	const output = await new Deno.Command("git", {
		args: ["-C", cwd, ...args],
		stderr: "piped",
		stdout: "null",
	}).output();
	if (!output.success) throw new Error(new TextDecoder().decode(output.stderr));
}

async function waitFor(predicate: () => boolean): Promise<void> {
	const deadline = Date.now() + 5_000;
	while (!predicate()) {
		if (Date.now() >= deadline) throw new Error("Timed out waiting for Git state");
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
}
