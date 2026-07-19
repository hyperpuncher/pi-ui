import { parsePatchFiles } from "@pierre/diffs";

import {
	type WorkspaceCommit,
	type WorkspaceCommitDetail,
	type WorkspaceFileChange,
	type WorkspaceFileStatus,
	workspaceReviewHistoryPageSize,
	type WorkspaceReviewSnapshot,
} from "../workspace-review-types.ts";
export type {
	WorkspaceCommit,
	WorkspaceCommitDetail,
	WorkspaceFileChange,
	WorkspaceFileStatus,
	WorkspaceReviewSnapshot,
} from "../workspace-review-types.ts";

type GitResult = Readonly<{ code: number; stderr: string; stdout: string }>;
const commitLogFormat = "--format=format:%H%x1f%h%x1f%an%x1f%aI%x1f%s%x1e";
const decoder = new TextDecoder();
const untrackedDiffConcurrency = 4;

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

export async function readWorkspaceReviewAvailability(
	workspacePath: string,
): Promise<WorkspaceReviewSnapshot> {
	return (await findGitRoot(workspacePath))
		? {
				branch: null,
				changes: [],
				commits: [],
				isGitRepository: true,
				patch: "",
				revision: "git-unloaded",
			}
		: emptySnapshot;
}

export async function readWorkspaceReview(
	workspacePath: string,
): Promise<WorkspaceReviewSnapshot> {
	const root = await findGitRoot(workspacePath);
	if (!root) return emptySnapshot;
	const [statusResult, headResult, logResult, upstreamResult, branchResult] =
		await Promise.all([
			git(root, "status", "--porcelain=v1", "--untracked-files=all", "-z"),
			git(root, "rev-parse", "--verify", "HEAD"),
			git(
				root,
				"log",
				"-n",
				String(workspaceReviewHistoryPageSize),
				commitLogFormat,
			),
			git(
				root,
				"rev-list",
				`--max-count=${workspaceReviewHistoryPageSize}`,
				"@{upstream}..HEAD",
			),
			git(root, "symbolic-ref", "--quiet", "--short", "HEAD"),
		]);
	assertGit(statusResult, "read repository status");

	let changes = parsePorcelainStatus(statusResult.stdout).sort((a, b) =>
		a.path.localeCompare(b.path, "en", { numeric: true }),
	);
	const tracked = await git(
		root,
		"diff",
		"--no-color",
		"--no-ext-diff",
		"--find-renames",
		"--unified=3",
		...(headResult.code === 0 ? ["HEAD"] : ["--cached"]),
		"--",
	);
	assertGit(tracked, "read tracked changes");

	const patches = [tracked.stdout];
	const untracked = changes.filter(({ status }) => status === "untracked");
	for (let index = 0; index < untracked.length; index += untrackedDiffConcurrency) {
		const batch = untracked.slice(index, index + untrackedDiffConcurrency);
		const results = await Promise.all(
			batch.map(({ path }) =>
				git(
					root,
					"diff",
					"--no-index",
					"--no-color",
					"--no-ext-diff",
					"--unified=3",
					"--",
					"/dev/null",
					path,
				),
			),
		);
		for (const result of results) {
			if (result.code > 1) assertGit(result, "read untracked change");
			patches.push(result.stdout);
		}
	}

	const patch = patches
		.map((value) => value.trimEnd())
		.filter(Boolean)
		.join("\n");
	changes = addStats(changes, patch);
	return {
		branch:
			branchResult.code === 0
				? branchResult.stdout.trim()
				: headResult.code === 0
					? `detached@${headResult.stdout.trim().slice(0, 7)}`
					: null,
		changes,
		commits:
			logResult.code === 0
				? parseCommitLog(logResult.stdout, unpushedHashes(upstreamResult))
				: [],
		isGitRepository: true,
		patch,
		revision: await hash(
			JSON.stringify([
				statusResult.stdout,
				patch,
				headResult.stdout,
				upstreamResult.code,
				upstreamResult.stdout,
				branchResult.stdout,
			]),
		),
	};
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
		patch: patchResult.stdout.trimEnd(),
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
	const records = output.split("\0");
	const changes: WorkspaceFileChange[] = [];
	for (let index = 0; index < records.length; index++) {
		const record = records[index];
		if (!record || record.length < 4) continue;
		const code = record.slice(0, 2);
		changes.push({
			additions: 0,
			deletions: 0,
			path: record.slice(3),
			status: statusFromCode(code),
		});
		if (code.includes("R") || code.includes("C")) index++;
	}
	return changes;
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
	const output = await new Deno.Command("git", {
		args: ["-C", cwd, "-c", "core.quotePath=false", ...args],
		stderr: "piped",
		stdout: "piped",
	}).output();
	return {
		code: output.code,
		stderr: decoder.decode(output.stderr),
		stdout: decoder.decode(output.stdout),
	};
}

const emptySnapshot: WorkspaceReviewSnapshot = {
	branch: null,
	changes: [],
	commits: [],
	isGitRepository: false,
	patch: "",
	revision: "non-git",
};
