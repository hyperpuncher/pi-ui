import { parsePatchFiles } from "@pierre/diffs";

import type {
	WorkspaceFileChange,
	WorkspaceFileStatus,
	WorkspaceReviewSnapshot,
} from "../workspace-review-types.ts";
export type {
	WorkspaceFileChange,
	WorkspaceFileStatus,
	WorkspaceReviewSnapshot,
} from "../workspace-review-types.ts";

type GitResult = Readonly<{ code: number; stderr: string; stdout: string }>;
const decoder = new TextDecoder();
const untrackedDiffConcurrency = 4;

export async function findGitRoot(workspacePath: string): Promise<string | undefined> {
	const result = await git(workspacePath, "rev-parse", "--show-toplevel");
	return result.code === 0 ? result.stdout.trim() : undefined;
}

export async function readWorkspaceReviewAvailability(
	workspacePath: string,
): Promise<WorkspaceReviewSnapshot> {
	return (await findGitRoot(workspacePath))
		? {
				changes: [],
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
	const [statusResult, headResult] = await Promise.all([
		git(root, "status", "--porcelain=v1", "--untracked-files=all", "-z"),
		git(root, "rev-parse", "--verify", "HEAD"),
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
		changes,
		isGitRepository: true,
		patch,
		revision: await hash(JSON.stringify([statusResult.stdout, patch])),
	};
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
	changes: [],
	isGitRepository: false,
	patch: "",
	revision: "non-git",
};
