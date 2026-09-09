import { execFile } from "node:child_process";

import { parsePatchFiles } from "@pierre/diffs";

import { outputCommand } from "../utils/command.ts";
import { isNotFound } from "../utils/fs-errors.ts";
import { sortWorkspaceReviewEntries } from "../workspace-review-tree.ts";
import {
	type WorkspaceCommit,
	type WorkspaceCommitDetail,
	emptyWorkspaceReviewSnapshot,
	type WorkspaceFileChange,
	type WorkspaceFileStatus,
	workspaceReviewHistoryPageSize,
	type WorkspaceReviewSnapshot,
} from "../workspace-review-types.ts";
export type {
	WorkspaceCommit,
	WorkspaceCommitDetail,
	WorkspaceFileChange,
	WorkspaceReviewSnapshot,
} from "../workspace-review-types.ts";

type GitResult = Readonly<{ code: number; stderr: string; stdout: string }>;
const commitLogFormat = "--format=format:%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1e";
const decoder = new TextDecoder();
export const maximumWorkspaceDiffBytes = 2 * 1024 * 1024;
const maximumAllDiffFiles = 100;

/** An inconclusive ignore check must never suppress a workspace refresh. */
export async function areWorkspacePathsIgnored(
	root: string,
	paths: readonly string[],
): Promise<boolean> {
	if (paths.length === 0) return false;
	try {
		const result = await outputCommand("git", {
			args: ["-C", root, "check-ignore", "--stdin", "-z"],
			stdin: new TextEncoder().encode(`${paths.join("\0")}\0`),
		});
		if (!result.success) return false;
		const ignored = new Set(decoder.decode(result.stdout).split("\0"));
		return paths.every((path) => ignored.has(path));
	} catch {
		return false;
	}
}

export async function findGitRoot(workspacePath: string): Promise<string | undefined> {
	const result = await git(workspacePath, "rev-parse", "--show-toplevel");
	return result.code === 0 ? result.stdout.trim() : undefined;
}

export async function findGitWatchPaths(
	workspacePath: string,
): Promise<string[] | undefined> {
	const root = await findGitRoot(workspacePath);
	if (!root) return undefined;
	const [gitDirResult, commonDirResult] = await Promise.all([
		git(root, "rev-parse", "--absolute-git-dir"),
		git(root, "rev-parse", "--path-format=absolute", "--git-common-dir"),
	]);
	const paths = [root];
	for (const result of [gitDirResult, commonDirResult]) {
		const path = result.code === 0 ? result.stdout.trim() : "";
		if (
			path &&
			path !== root &&
			!path.startsWith(`${root}/`) &&
			!paths.includes(path)
		) {
			paths.push(path);
		}
	}
	return paths;
}

export type WorkspaceReviewMetadataCache = {
	value?: Awaited<ReturnType<typeof readWorkspaceMetadata>>;
};

async function readWorkspaceMetadata(root: string) {
	const [headResult, logResult, branchResult] = await Promise.all([
		git(root, "rev-parse", "--verify", "HEAD"),
		git(root, "log", "-n", String(workspaceReviewHistoryPageSize), commitLogFormat),
		git(root, "symbolic-ref", "--quiet", "--short", "HEAD"),
	]);
	return { root, headResult, logResult, branchResult };
}

export async function readWorkspaceReview(
	workspacePath: string,
	metadataCache?: WorkspaceReviewMetadataCache,
): Promise<WorkspaceReviewSnapshot> {
	const root = await findGitRoot(workspacePath);
	if (!root) return emptyWorkspaceReviewSnapshot;
	const statusPromise = git(
		root,
		"status",
		"--porcelain=v1",
		"--untracked-files=all",
		"-z",
	);
	const summaryPromise = git(
		root,
		"status",
		"--porcelain=v1",
		"--untracked-files=normal",
		"-z",
	);
	const upstreamPromise = git(
		root,
		"rev-list",
		`--max-count=${workspaceReviewHistoryPageSize}`,
		"@{upstream}..HEAD",
	);
	const metadata =
		metadataCache?.value?.root === root
			? metadataCache.value
			: await readWorkspaceMetadata(root);
	const { headResult, logResult, branchResult } = metadata;
	// Failed reads must be retried, not retained as an empty history.
	if (
		metadataCache &&
		headResult.code === 0 &&
		logResult.code === 0 &&
		(branchResult.code === 0 || branchResult.code === 1)
	)
		metadataCache.value = metadata;
	const upstreamResult = await upstreamPromise;
	const branch =
		branchResult.code === 0
			? branchResult.stdout.trim()
			: headResult.code === 0
				? `detached@${headResult.stdout.trim().slice(0, 7)}`
				: null;
	const commits =
		logResult.code === 0
			? parseCommitLog(logResult.stdout, unpushedHashes(upstreamResult))
			: [];
	const metadataRevisionInputs = [
		headResult.stdout,
		upstreamResult.code,
		upstreamResult.stdout,
		branchResult.stdout,
	];
	const [statusResult, summaryResult] = await Promise.all([
		statusPromise,
		summaryPromise,
	]);
	assertGit(statusResult, "read repository status");
	assertGit(summaryResult, "read grouped repository status");
	const changeCount = parsePorcelainEntries(summaryResult.stdout).length;
	let changes = sortWorkspaceReviewEntries(parsePorcelainStatus(statusResult.stdout));
	const revisionInputs = [
		statusResult.stdout,
		summaryResult.stdout,
		...metadataRevisionInputs,
	];
	let counts = "";
	if (changes.some((change) => change.status !== "untracked")) {
		const stats = await git(
			root,
			"diff",
			"--numstat",
			"--find-renames",
			"-z",
			"--no-ext-diff",
			"--no-textconv",
			...(headResult.code === 0 ? ["HEAD"] : ["--cached"]),
			"--",
		);
		assertGit(stats, "read change counts");
		counts = stats.stdout;
		changes = addNumStats(changes, counts);
	}
	return {
		branch,
		changes,
		commits,
		isGitRepository: true,
		changeCount,
		revision: await hash(JSON.stringify([revisionInputs, counts])),
	};
}

// Diff contents never belong in the live workspace snapshot. Read them only
// for an explicit review request, bounded before buffering or parsing them.
export async function readWorkspaceDiff(
	workspacePath: string,
	path?: string,
	signal?: AbortSignal,
): Promise<string> {
	const root = await findGitRoot(workspacePath);
	if (!root) throw new WorkspaceReviewError(404, "Git repository not found.");
	const status = await boundedGit(
		root,
		["status", "--porcelain=v1", "--untracked-files=all", "-z"],
		signal,
	);
	const entries = parsePorcelainEntries(status);
	const selected =
		path === undefined ? entries : entries.filter((entry) => entry.path === path);
	if (path !== undefined && selected.length === 0)
		throw new WorkspaceReviewError(404, "Changed file not found.");
	if (selected.length > maximumAllDiffFiles)
		throw new WorkspaceReviewError(
			413,
			"Too many changes for All files. Select a file to review.",
		);
	if (selected.length === 0) return "";
	const options = [
		"diff",
		"--find-renames",
		"--no-color",
		"--no-ext-diff",
		"--no-textconv",
		"--unified=3",
	];
	const tracked = selected.filter((entry) => entry.code !== "??");
	let patch = "";
	if (tracked.length > 0) {
		const head = await git(root, "rev-parse", "--verify", "HEAD");
		const paths = tracked.flatMap((entry) =>
			entry.sourcePath ? [entry.path, entry.sourcePath] : [entry.path],
		);
		patch = await boundedGit(
			root,
			[...options, ...(head.code === 0 ? ["HEAD"] : ["--cached"]), "--", ...paths],
			signal,
		);
	}
	for (const entry of selected.filter((entry) => entry.code === "??")) {
		patch += await boundedGit(
			root,
			[...options, "--no-index", "--", "/dev/null", entry.path],
			signal,
			maximumWorkspaceDiffBytes - Buffer.byteLength(patch),
		);
	}
	return patch;
}

function boundedGit(
	root: string,
	args: string[],
	signal?: AbortSignal,
	maxBuffer = maximumWorkspaceDiffBytes,
): Promise<string> {
	signal?.throwIfAborted();
	if (maxBuffer <= 0)
		throw new WorkspaceReviewError(
			413,
			"Diff too large to preview. Select a smaller file.",
		);
	return new Promise((resolve, reject) => {
		execFile(
			"git",
			["-C", root, "--literal-pathspecs", "-c", "core.quotePath=false", ...args],
			{
				encoding: "utf8",
				maxBuffer,
				signal,
				windowsHide: true,
				env: { ...process.env, GIT_OPTIONAL_LOCKS: "0" },
			},
			(error, stdout) => {
				if (signal?.aborted) reject(signal.reason);
				else if (error?.code === "ERR_CHILD_PROCESS_STDIO_MAXBUFFER")
					reject(
						new WorkspaceReviewError(
							413,
							"Diff too large to preview. Select a smaller file.",
						),
					);
				else if (error && !(args[0] === "diff" && error.code === 1))
					reject(error);
				else resolve(stdout);
			},
		);
	});
}

export async function discardWorkspaceChange(
	workspacePath: string,
	changePath: string,
): Promise<void> {
	const root = await findGitRoot(workspacePath);
	if (!root) throw new WorkspaceReviewError(404, "Git repository not found.");
	const statusResult = await git(
		root,
		"status",
		"--porcelain=v1",
		"--untracked-files=all",
		"-z",
	);
	assertGit(statusResult, "read repository status");
	const entry = parsePorcelainEntries(statusResult.stdout).find(
		({ path }) => path === changePath,
	);
	if (!entry) throw new WorkspaceReviewError(409, "This file is no longer changed.");

	if (entry.code === "??") {
		const result = await git(root, "clean", "-f", "--", entry.path);
		assertGit(result, "discard untracked file");
		return;
	}

	const head = await git(root, "rev-parse", "--verify", "HEAD");
	const paths = entry.sourcePath ? [entry.path, entry.sourcePath] : [entry.path];
	const result =
		head.code === 0
			? await git(
					root,
					"restore",
					"--source=HEAD",
					"--staged",
					"--worktree",
					"--",
					...paths,
				)
			: await git(root, "rm", "-f", "--", ...paths);
	assertGit(result, "discard file changes");
}

export class WorkspaceReviewError extends Error {
	constructor(
		readonly status: number,
		message: string,
	) {
		super(message);
		this.name = "WorkspaceReviewError";
	}
}

export async function readWorkspaceCommit(
	workspacePath: string,
	hash: string,
): Promise<WorkspaceCommitDetail | undefined> {
	if (!/^[0-9a-f]{40}$/i.test(hash)) return undefined;
	const root = await findGitRoot(workspacePath);
	if (!root) return undefined;
	const [metadataResult, statusResult, patchResult, upstreamResult] = await Promise.all(
		[
			git(root, "show", "-s", commitLogFormat, hash),
			git(
				root,
				"diff-tree",
				"--root",
				"--no-commit-id",
				"--name-status",
				"-r",
				"-z",
				"--find-renames",
				"--diff-merges=first-parent",
				hash,
			),
			git(
				root,
				"show",
				"--format=",
				"--no-color",
				"--no-ext-diff",
				"--find-renames",
				"--diff-merges=first-parent",
				"--root",
				"--unified=3",
				hash,
				"--",
			),
			git(root, "merge-base", "--is-ancestor", hash, "@{upstream}"),
		],
	);
	if (metadataResult.code !== 0 || statusResult.code !== 0 || patchResult.code !== 0)
		return undefined;
	const commit = parseCommitLog(
		metadataResult.stdout,
		commitPushSet(upstreamResult, hash),
	)[0];
	if (!commit) return undefined;
	return {
		changes: addStats(parseNameStatus(statusResult.stdout), patchResult.stdout),
		commit,
		patch: patchResult.stdout,
	};
}

export async function readWorkspaceHistory(
	workspacePath: string,
	offset: number,
): Promise<WorkspaceCommit[]> {
	if (!Number.isSafeInteger(offset) || offset < 0 || offset > 100_000) return [];
	const root = await findGitRoot(workspacePath);
	if (!root) return [];
	const [logResult, upstreamResult] = await Promise.all([
		git(
			root,
			"log",
			"-n",
			String(workspaceReviewHistoryPageSize),
			`--skip=${offset}`,
			commitLogFormat,
		),
		git(
			root,
			"rev-list",
			`--max-count=${workspaceReviewHistoryPageSize}`,
			`--skip=${offset}`,
			"@{upstream}..HEAD",
		),
	]);
	return logResult.code === 0
		? parseCommitLog(logResult.stdout, unpushedHashes(upstreamResult))
		: [];
}

export function parseCommitLog(
	output: string,
	unpushed?: ReadonlySet<string>,
): WorkspaceCommit[] {
	return output
		.split("\x1e")
		.map((record) => record.replace(/^\n+|\n+$/g, ""))
		.filter(Boolean)
		.flatMap((record) => {
			const [hash, shortHash, author, authoredAt, subject] = record.split("\x1f");
			return hash && shortHash && authoredAt
				? [
						{
							author,
							authoredAt,
							hash,
							pushed: unpushed ? !unpushed.has(hash) : null,
							shortHash,
							subject,
						},
					]
				: [];
		});
}

export function parsePorcelainStatus(output: string): WorkspaceFileChange[] {
	return parsePorcelainEntries(output).map(({ code, path }) => ({
		additions: 0,
		deletions: 0,
		path,
		status: statusFromCode(code),
	}));
}

function parsePorcelainEntries(output: string): Array<{
	code: string;
	path: string;
	sourcePath?: string;
}> {
	const records = output.split("\0");
	const entries = [];
	for (let index = 0; index < records.length; index++) {
		const record = records[index];
		if (!record || record.length < 4) continue;
		const code = record.slice(0, 2);
		const renamed = code.includes("R") || code.includes("C");
		entries.push({
			code,
			path: record.slice(3),
			sourcePath: renamed ? records[++index] : undefined,
		});
	}
	return entries;
}

export function parseNameStatus(output: string): WorkspaceFileChange[] {
	const records = output.split("\0");
	const changes: WorkspaceFileChange[] = [];
	for (let index = 0; index < records.length; index++) {
		const code = records[index];
		if (!code) continue;
		const renamed = code.startsWith("R") || code.startsWith("C");
		const firstPath = records[++index];
		const path = renamed ? records[++index] : firstPath;
		if (!path) continue;
		changes.push({
			additions: 0,
			deletions: 0,
			path,
			status: statusFromCode(code),
		});
	}
	return changes;
}

function addNumStats(
	changes: readonly WorkspaceFileChange[],
	output: string,
): WorkspaceFileChange[] {
	const records = output.split("\0");
	const stats = new Map<string, { additions: number; deletions: number }>();
	for (let index = 0; index < records.length; index++) {
		const match = /^(\d+|-)\t(\d+|-)\t([\s\S]*)$/.exec(records[index]!);
		if (!match) continue;
		let path = match[3]!;
		if (!path) {
			index += 2; // A rename has separate old and new path records.
			path = records[index]!;
		}
		stats.set(path, {
			additions: Number(match[1]) || 0,
			deletions: Number(match[2]) || 0,
		});
	}
	return changes.map((change) => ({ ...change, ...stats.get(change.path) }));
}

function addStats(
	changes: readonly WorkspaceFileChange[],
	patch: string,
): WorkspaceFileChange[] {
	const stats = new Map<string, { additions: number; deletions: number }>();
	for (const parsed of parsePatchFiles(patch)) {
		for (const file of parsed.files) {
			stats.set(file.name, {
				additions: file.hunks.reduce((sum, hunk) => sum + hunk.additionLines, 0),
				deletions: file.hunks.reduce((sum, hunk) => sum + hunk.deletionLines, 0),
			});
		}
	}
	return changes.map((change) => ({ ...change, ...stats.get(change.path) }));
}

function statusFromCode(code: string): WorkspaceFileStatus {
	if (code === "??") return "untracked";
	if (code.includes("R") || code.includes("C")) return "renamed";
	if (code.includes("D")) return "deleted";
	if (code.includes("A")) return "added";
	return "modified";
}

async function hash(value: string): Promise<string> {
	const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
	return Array.from(new Uint8Array(digest), (byte) =>
		byte.toString(16).padStart(2, "0"),
	).join("");
}

function commitPushSet(result: GitResult, hash: string): ReadonlySet<string> | undefined {
	if (result.code === 0) return new Set();
	if (result.code === 1) return new Set([hash]);
	return undefined;
}

function unpushedHashes(result: GitResult): ReadonlySet<string> | undefined {
	return result.code === 0
		? new Set(result.stdout.split("\n").filter(Boolean))
		: undefined;
}

function assertGit(result: GitResult, action: string): void {
	if (result.code !== 0)
		throw new Error(`Unable to ${action}: ${result.stderr.trim()}`);
}

async function git(cwd: string, ...args: string[]): Promise<GitResult> {
	try {
		const output = await outputCommand("git", {
			args: ["-C", cwd, "-c", "core.quotePath=false", ...args],
			env: { GIT_OPTIONAL_LOCKS: "0" },
		});
		return {
			code: output.code,
			stderr: decoder.decode(output.stderr),
			stdout: decoder.decode(output.stdout),
		};
	} catch (error) {
		if (!isNotFound(error)) throw error;
		return { code: 127, stderr: "Git executable not found.", stdout: "" };
	}
}
