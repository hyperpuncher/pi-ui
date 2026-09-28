import { expect, test } from "bun:test";

import type { GitWorktreeContext } from "#src/server/git-worktrees.ts";
import {
	renderBranchDeleteDialog,
	renderWorktreeDialogContent,
	renderWorktreeIgnoredPaths,
	renderWorktreeRemoveDialog,
	worktreeSwitchableBranches,
} from "#src/ui/worktree-dialog.tsx";

function makeContext(overrides: Partial<GitWorktreeContext> = {}): GitWorktreeContext {
	return {
		projectRoot: "/projects/example",
		workspaceRelative: "",
		currentBranch: "main",
		branches: [
			{ label: "main", ref: "refs/heads/main", worktreePath: "/projects/example" },
		],
		worktrees: [
			{
				path: "/projects/example",
				sessionPath: "/projects/example",
				head: "1234567890abcdef",
				branch: "main",
				current: true,
				missing: false,
			},
		],
		...overrides,
	};
}

test("worktree dialog lists checkouts and leaves the new branch name empty", () => {
	const html = renderWorktreeDialogContent(
		makeContext({
			workspaceRelative: "packages/web",
			branches: [
				{
					label: "main",
					ref: "refs/heads/main",
					worktreePath: "/projects/example",
				},
				{ label: "origin/next", ref: "refs/remotes/origin/next" },
			],
			worktrees: [
				{
					path: "/projects/example",
					sessionPath: "/projects/example/packages/web",
					head: "1234567890abcdef",
					branch: "main",
					current: true,
					missing: false,
				},
				{
					path: "/worktrees/feature",
					sessionPath: "/worktrees/feature/packages/web",
					head: "abcdef1234567890",
					branch: "feature/plain-name",
					current: false,
					missing: false,
				},
			],
		}),
	);

	expect(html).toContain("feature/plain-name");
	expect(html).not.toContain("/projects/example");
	expect(html).toContain("/worktrees/feature/packages/web");
	expect(html).toContain('class="segmented-control worktree-tabs"');
	expect(html).toContain("data-bind:_branch-name");
	expect(html).toContain(`data-on:click="$_worktreeTab = 'branches'"`);
	expect(html).toContain(`data-show="$_worktreeTab === 'worktrees'"`);
	expect(html).not.toContain("No other branches.");
	expect(html.match(/aria-pressed="true"/g)).toHaveLength(1);
	expect(html).toContain('commandfor="worktree-dialog"');
	expect(html).toContain('commandfor="worktree-remove-dialog"');
	expect(html).toContain('aria-label="Remove feature/plain-name"');
	expect(html).toContain("refs/remotes/origin/next");
	expect(html).toContain('placeholder="feature/my-branch"');
	expect(html).toContain('role="menuitemradio"');
	expect(html).toContain('popovertarget="worktree-base-popover"');
	expect(html).not.toContain("<select");
	expect(html).not.toContain("pi-ui/");
	expect(html).toContain("/worktrees/create");
});

test("worktree dialog hides the current checkout from existing worktrees", () => {
	const html = renderWorktreeDialogContent(makeContext());

	expect(html).not.toContain("No other worktrees.");
	expect(html).not.toContain("/projects/example");
	expect(html).not.toContain('aria-label="Remove');
});

test("worktree dialog offers HEAD when the current branch has no ref", () => {
	const unborn = renderWorktreeDialogContent(
		makeContext({ currentBranch: "main", branches: [] }),
	);
	expect(unborn).toContain("HEAD (unborn)");
	expect(unborn.match(/role="menuitemradio"/g)).toHaveLength(1);

	const detached = renderWorktreeDialogContent(
		makeContext({ currentBranch: undefined, branches: [] }),
	);
	expect(detached).toContain("HEAD (detached)");
	expect(detached.match(/role="menuitemradio"/g)).toHaveLength(1);
});

test("worktree dialog does not offer removal for the main checkout", () => {
	const html = renderWorktreeDialogContent(
		makeContext({
			currentBranch: "feature/plain-name",
			branches: [
				{
					label: "feature/plain-name",
					ref: "refs/heads/feature/plain-name",
					worktreePath: "/worktrees/feature",
				},
			],
			worktrees: [
				{
					path: "/projects/example",
					sessionPath: "/projects/example",
					head: "abcdef1234567890",
					branch: "main",
					current: false,
					missing: false,
				},
				{
					path: "/worktrees/feature",
					sessionPath: "/worktrees/feature",
					head: "1234567890abcdef",
					branch: "feature/plain-name",
					current: true,
					missing: false,
				},
			],
		}),
	);

	expect(html).toContain(">main<");
	expect(html).not.toContain('commandfor="worktree-remove-dialog"');
});

test("worktree dialog switches to other local branches only", () => {
	const html = renderWorktreeDialogContent(
		makeContext({
			currentBranch: "main",
			branches: [
				{
					label: "main",
					ref: "refs/heads/main",
					worktreePath: "/projects/example",
				},
				{ label: "feature/next", ref: "refs/heads/feature/next" },
				{ label: "origin/next", ref: "refs/remotes/origin/next" },
			],
		}),
	);

	expect(html).toContain(">Branches<");
	expect(html).toContain("/branches/switch");
	expect(html).toContain("/branches/create");
	expect(html).toContain('aria-label="Delete feature/next"');
	expect(html).toContain("branch: &#34;feature/next&#34;");
	expect(html).not.toContain("branch: &#34;main&#34;");
	expect(html).not.toContain("branch: &#34;origin/next&#34;");
});

test("worktree switchable branches exclude checked-out local branches", () => {
	const branches = worktreeSwitchableBranches([
		{
			label: "main",
			ref: "refs/heads/main",
			worktreePath: "/projects/example",
		},
		{
			label: "feature/checked-out",
			ref: "refs/heads/feature/checked-out",
			worktreePath: "/worktrees/feature",
		},
		{ label: "origin/next", ref: "refs/remotes/origin/next" },
		{ label: "feature/free", ref: "refs/heads/feature/free" },
	]);

	expect(branches.map((branch) => branch.label)).toEqual(["feature/free"]);
});

test("worktree dialog does not switch to branches checked out elsewhere", () => {
	const html = renderWorktreeDialogContent(
		makeContext({
			currentBranch: "main",
			branches: [
				{
					label: "main",
					ref: "refs/heads/main",
					worktreePath: "/projects/example",
				},
				{
					label: "feature/checked-out",
					ref: "refs/heads/feature/checked-out",
					worktreePath: "/worktrees/feature",
				},
				{ label: "feature/free", ref: "refs/heads/feature/free" },
			],
			worktrees: [
				{
					path: "/projects/example",
					sessionPath: "/projects/example",
					head: "1234567890abcdef",
					branch: "main",
					current: true,
					missing: false,
				},
				{
					path: "/worktrees/feature",
					sessionPath: "/worktrees/feature",
					head: "abcdef1234567890",
					branch: "feature/checked-out",
					current: false,
					missing: false,
				},
			],
		}),
	);

	expect(html).toContain("branch: &#34;feature/free&#34;");
	expect(html).not.toContain("branch: &#34;feature/checked-out&#34;");
});

test("branch delete dialog confirms destructive deletion", () => {
	const html = renderBranchDeleteDialog();

	expect(html).toContain("/branches/delete");
	expect(html).toContain("Unmerged commits are discarded.");
});

test("worktree removal previews ignored paths before accepting them", () => {
	const html = renderWorktreeRemoveDialog();
	const listed = renderWorktreeIgnoredPaths(["node_modules/", "<secret>.env"]);

	expect(html).toContain("/worktrees/remove");
	expect(html).toContain("Modified and untracked files block removal");
	expect(html).toContain("sessions and any branch will remain");
	expect(html).toMatch(/!\$_worktreeRemoveReady\s*\|\|\s*\$_worktreeRemoving/);
	expect(html).toContain("Remove checkout and ignored files");
	expect(html).toContain("revision: $_worktreeRemoveRevision");
	expect(html).not.toContain("_worktreeRemoveBranch");
	expect(listed).toContain("node_modules/");
	expect(listed).toContain("&lt;secret&gt;.env");
	expect(listed).not.toContain("<secret>.env");
});

test("worktree dialog explains when the workspace is not a Git repository", () => {
	expect(renderWorktreeDialogContent(undefined)).toContain(
		"The current workspace is not inside a Git repository.",
	);
});
