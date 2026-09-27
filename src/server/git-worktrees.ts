import { mkdir, realpath, stat } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";

import { isNotFound } from "../utils/fs-errors.ts";
import { appWorktreeRoot, managedWorktreeDirectoryName } from "../utils/workspace.ts";
import { type CommandOutput, gitText, runGit } from "./git.ts";

export type GitWorktree = Readonly<{
	path: string;
	sessionPath: string;
	head: string;
	branch?: string;
	current: boolean;
	missing: boolean;
}>;

export type GitBranch = Readonly<{
	label: string;
	ref: string;
	/** Path of the worktree holding this branch, empty when it is not checked out. */
	worktreePath?: string;
}>;

export type GitWorktreeContext = Readonly<{
	projectRoot: string;
	workspaceRelative: string;
	currentBranch?: string;
	branches: readonly GitBranch[];
	worktrees: readonly GitWorktree[];
}>;

export type CreatedGitWorktree = Readonly<{
	path: string;
	sessionPath: string;
	branch: string;
	projectRoot: string;
}>;

export class GitWorktreeError extends Error {}

/** Resolves the main worktree of the repository containing `workspacePath`. */
export async function findGitProjectRoot(
	workspacePath: string,
): Promise<string | undefined> {
	const listed = await runGit(workspacePath, ["worktree", "list", "--porcelain", "-z"]);
	if (!listed.success) return undefined;
	const [primary] = parseWorktrees(listed.stdout);
	if (!primary) return undefined;
	return await realpath(primary.path).catch(() => primary.path);
}

export async function inspectGitWorktrees(
	workspacePath: string,
): Promise<GitWorktreeContext | undefined> {
	// Git lists the main worktree first, which keeps this lookup cheap.
	const listed = await runGit(workspacePath, ["worktree", "list", "--porcelain", "-z"]);
	if (!listed.success) return undefined;
	const workspace = await realpath(workspacePath).catch(() => workspacePath);
	const entries = await Promise.all(
		parseWorktrees(listed.stdout).map(async (worktree) => {
			const path = await realpath(worktree.path).catch(() => undefined);
			return {
				...worktree,
				path: path ?? worktree.path,
				missing: path === undefined,
			};
		}),
	);
	const projectRoot = entries[0]?.path;
	if (!projectRoot) return undefined;
	let current: (typeof entries)[number] | undefined;
	for (const entry of entries) {
		if (entry.missing || !contains(entry.path, workspace)) continue;
		if (!current || entry.path.length > current.path.length) current = entry;
	}
	const workspaceRelative = current ? relative(current.path, workspace) : "";
	const worktrees = await Promise.all(
		entries.map(async (worktree) => ({
			path: worktree.path,
			sessionPath: await worktreeSessionPath(worktree.path, workspaceRelative),
			head: worktree.head,
			branch: worktree.branch,
			current: worktree === current,
			missing: worktree.missing,
		})),
	);
	const branchesResult = await runGit(current?.path ?? projectRoot, [
		"for-each-ref",
		"--format=%(refname)%09%(refname:short)%09%(worktreepath)%00",
		"--exclude=refs/remotes/*/HEAD",
		"--sort=-committerdate",
		"refs/heads",
		"refs/remotes",
	]);
	if (!branchesResult.success)
		throw gitError(branchesResult, "Could not list branches.");
	const branches: GitBranch[] = [];
	for (const record of gitText(branchesResult.stdout).split("\0")) {
		// Git writes a newline after the NUL that terminates each formatted ref.
		const [ref, label, ...rest] = record.trimStart().split("\t");
		if (!ref || !label) continue;
		const worktreePath = rest.join("\t");
		branches.push(worktreePath ? { ref, label, worktreePath } : { ref, label });
	}
	return {
		projectRoot,
		workspaceRelative,
		currentBranch: current?.branch,
		branches,
		worktrees,
	};
}

/** Default base ref for a new checkout: the current branch when it is listed. */
export function defaultWorktreeBase(context: GitWorktreeContext | undefined): string {
	const ref = context?.currentBranch
		? `refs/heads/${context.currentBranch}`
		: undefined;
	return ref && context?.branches.some((branch) => branch.ref === ref) ? ref : "HEAD";
}

export async function createGitWorktree(
	workspacePath: string,
	branch: string,
	base: string,
	worktreeRoot = appWorktreeRoot(),
): Promise<CreatedGitWorktree> {
	const context = await inspectGitWorktrees(workspacePath);
	if (!context)
		throw new GitWorktreeError("The current workspace is not a Git repository.");
	const branchName = branch.trim();
	const baseRef = base.trim();
	if (!branchName || !baseRef)
		throw new GitWorktreeError("Choose a base branch and enter a branch name.");
	if (!context.branches.some(({ ref }) => ref === baseRef) && baseRef !== "HEAD")
		throw new GitWorktreeError("Choose an available base branch.");

	const parent = join(
		worktreeRoot,
		safeName(basename(context.projectRoot)) || "repository",
	);
	const path = join(parent, managedWorktreeDirectoryName(branchName));
	await mkdir(parent, { recursive: true });
	const currentHead = context.worktrees.find((worktree) => worktree.current)?.head;
	const unborn = baseRef === "HEAD" && /^0+$/.test(currentHead ?? "");
	const created = await runGit(
		workspacePath,
		unborn
			? ["worktree", "add", "--orphan", "-b", branchName, path]
			: ["worktree", "add", "-b", branchName, path, baseRef],
	);
	if (!created.success) throw gitError(created, "Could not create the worktree.");
	return {
		path,
		sessionPath: await worktreeSessionPath(path, context.workspaceRelative),
		branch: branchName,
		projectRoot: context.projectRoot,
	};
}

export async function switchGitBranch(
	workspacePath: string,
	branch: string,
): Promise<void> {
	const switched = await runGit(workspacePath, ["switch", branch]);
	if (!switched.success) throw gitError(switched, "Could not switch branch.");
}

/** Creates and checks out a branch from the current HEAD. */
export async function createGitBranch(
	workspacePath: string,
	branch: string,
): Promise<void> {
	const branchName = branch.trim();
	if (!branchName) throw new GitWorktreeError("Enter a branch name.");
	const created = await runGit(workspacePath, ["switch", "-c", branchName]);
	if (!created.success) throw gitError(created, "Could not create the branch.");
}

/** Deletes a local branch. Git refuses the current branch and other checkouts. */
export async function deleteGitBranch(
	workspacePath: string,
	branch: string,
): Promise<void> {
	const branchName = branch.trim();
	if (!branchName) throw new GitWorktreeError("Choose a branch to delete.");
	const deleted = await runGit(workspacePath, ["branch", "-D", branchName]);
	if (!deleted.success) throw gitError(deleted, "Could not delete the branch.");
}

/** Keeps a repository subdirectory selected when moving between checkouts. */
export async function worktreeSessionPath(
	worktreeRoot: string,
	workspaceRelative: string,
): Promise<string> {
	if (!workspaceRelative) return worktreeRoot;
	const target = join(worktreeRoot, workspaceRelative);
	try {
		return (await stat(target)).isDirectory() ? target : worktreeRoot;
	} catch {
		return worktreeRoot;
	}
}

export async function ignoredWorktreePaths(
	worktreePath: string,
): Promise<{ paths: string[]; revision: string }> {
	try {
		await stat(worktreePath);
	} catch (error) {
		if (!isNotFound(error)) throw error;
		return { paths: [], revision: ignoredRevision(new Uint8Array()) };
	}
	// Git removes ignored files even without --force. Show directory entries rather
	// than walking every dependency file, and require consent to this exact list.
	const listed = await runGit(worktreePath, [
		"ls-files",
		"--others",
		"--ignored",
		"--exclude-standard",
		"--directory",
		"-z",
	]);
	if (!listed.success) throw gitError(listed, "Could not list ignored files.");
	return {
		paths: gitText(listed.stdout).split("\0").filter(Boolean),
		revision: ignoredRevision(listed.stdout),
	};
}

export async function removeGitWorktree(
	projectRoot: string,
	worktreePath: string,
	acknowledgedRevision?: string,
): Promise<void> {
	const { paths, revision } = await ignoredWorktreePaths(worktreePath);
	if (acknowledgedRevision !== undefined && acknowledgedRevision !== revision)
		throw new GitWorktreeError(
			"Ignored files changed. Review them before removing this checkout.",
		);
	if (acknowledgedRevision === undefined && paths.length > 0)
		throw new GitWorktreeError("Review ignored files before removing this checkout.");
	const removed = await runGit(projectRoot, ["worktree", "remove", worktreePath]);
	if (!removed.success) throw gitError(removed, "Could not remove the worktree.");
}

function ignoredRevision(bytes: Uint8Array): string {
	return new Bun.CryptoHasher("sha256").update(bytes).digest("hex");
}

type ParsedWorktree = Readonly<{ path: string; head: string; branch?: string }>;

function parseWorktrees(output: Uint8Array): ParsedWorktree[] {
	const worktrees: ParsedWorktree[] = [];
	for (const record of gitText(output).split("\0\0")) {
		let path = "";
		let head = "";
		let branch: string | undefined;
		for (const field of record.split("\0")) {
			// Boolean fields like `bare` and `detached` carry no value.
			const separator = field.indexOf(" ");
			if (separator < 0) continue;
			const key = field.slice(0, separator);
			const value = field.slice(separator + 1);
			if (key === "worktree") path = value;
			else if (key === "HEAD") head = value;
			else if (key === "branch" && value.startsWith("refs/heads/"))
				branch = value.slice("refs/heads/".length);
		}
		if (path && head) worktrees.push({ path, head, branch });
	}
	return worktrees;
}

function gitError(result: CommandOutput, fallback: string): GitWorktreeError {
	if (result.timedOut) return new GitWorktreeError("Git timed out.");
	const message = gitText(result.stderr).trim();
	return new GitWorktreeError(message || fallback);
}

function contains(root: string, path: string): boolean {
	return path === root || path.startsWith(`${root}${sep}`);
}

function safeName(value: string): string {
	return value.replaceAll(/[^a-zA-Z0-9._-]+/g, "-").replaceAll(/^-+|-+$/g, "");
}
