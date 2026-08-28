import { readdirSync, type Dirent } from "node:fs";
import * as path from "node:path";

import { outputCommand, type CommandOutput } from "../utils/command.ts";
import { expandHomePath } from "../utils/workspace.ts";

export type FileSuggestion = {
	value: string;
	label: string;
	description: string;
	isDirectory: boolean;
};

type FileSearchScope = {
	baseDir: string;
	displayBase: string;
	query: string;
};

const maxDepth = 4;
const maxScanned = 5_000;
const maxCollected = 30;
const maxResults = 20;
const fdMaxResults = 100;
const ignoredDirectoryNames = new Set(["node_modules", "__pycache__", ".venv", "venv"]);
const fdIgnoredDirectoryArgs = [...ignoredDirectoryNames].flatMap((name) => [
	"--exclude",
	name,
]);

export type FileSearchCommand = (
	args: string[],
	signal?: AbortSignal,
) => Promise<CommandOutput>;

const runFd: FileSearchCommand = (args, signal) => outputCommand("fd", { args, signal });

export async function searchFiles(
	workspacePath: string,
	query: string,
	signal?: AbortSignal,
	command: FileSearchCommand = runFd,
): Promise<FileSuggestion[]> {
	const normalizedQuery = query.replaceAll("\\", "/").replace(/^@/, "");
	const includeHidden = includesExplicitHiddenSegment(normalizedQuery);
	const scope = resolveFileSearchScope(workspacePath, normalizedQuery);
	const shallowResults = await searchWithFd(scope, signal, command, includeHidden, 1);
	if (shallowResults !== undefined) {
		if (shallowResults.length > 0 || !scope.query) return shallowResults;
		return (
			(await searchWithFd(scope, signal, command, includeHidden, maxDepth)) ?? []
		);
	}
	signal?.throwIfAborted();
	const shallowManualResults = searchManually(scope, includeHidden, 0);
	if (shallowManualResults.length > 0 || !scope.query) return shallowManualResults;
	return searchManually(scope, includeHidden, maxDepth);
}

async function searchWithFd(
	scope: FileSearchScope,
	signal: AbortSignal | undefined,
	command: FileSearchCommand,
	includeHidden: boolean,
	maxSearchDepth: number,
): Promise<FileSuggestion[] | undefined> {
	const args = [
		"--base-directory",
		scope.baseDir,
		"--max-results",
		String(fdMaxResults),
		"--type",
		"f",
		"--type",
		"d",
		"--max-depth",
		String(maxSearchDepth),
		"--exclude",
		".git",
		"--exclude",
		".git/*",
		"--exclude",
		".git/**",
		...fdIgnoredDirectoryArgs,
	];
	if (includeHidden) {
		args.push("--hidden");
	}
	if (scope.query) args.push(escapeRegex(scope.query));

	let output: CommandOutput;
	try {
		output = await command(args, signal);
	} catch (error) {
		if (signal?.aborted) throw signal.reason ?? error;
		return undefined;
	}
	signal?.throwIfAborted();
	if (!output.success) {
		return undefined;
	}

	const text = new TextDecoder().decode(output.stdout).trim();
	if (!text) {
		return [];
	}
	return text
		.split("\n")
		.filter(Boolean)
		.map((line) => toSuggestion(scope.displayBase, line))
		.filter((item) => !item.description.startsWith(".git/"))
		.sort(fileSuggestionComparator(scope.query))
		.slice(0, maxResults);
}

function toSuggestion(displayBase: string, line: string): FileSuggestion {
	const normalized = line.replaceAll("\\", "/");
	const isDirectory = normalized.endsWith("/");
	const relative = isDirectory ? normalized.slice(0, -1) : normalized;
	const displayPath = displayBase ? `${displayBase}${relative}` : relative;
	return {
		value: isDirectory ? `${displayPath}/` : displayPath,
		label: `${path.basename(displayPath)}${isDirectory ? "/" : ""}`,
		description: displayPath,
		isDirectory,
	};
}

function searchManually(
	scope: FileSearchScope,
	includeHidden: boolean,
	maxSearchDepth: number,
): FileSuggestion[] {
	const results: FileSuggestion[] = [];
	let scanned = 0;
	walkFiles(
		scope.baseDir,
		(entryPath, isDirectory) => {
			if (scanned >= maxScanned || results.length >= maxCollected) {
				return false;
			}
			scanned += 1;
			const relative = path
				.relative(scope.baseDir, entryPath)
				.replaceAll("\\", "/");
			if (!relative || relative.startsWith(".git/")) {
				return true;
			}
			const displayPath = scope.displayBase
				? `${scope.displayBase}${relative}`
				: relative;
			const score = scoreFile(displayPath, scope.query);
			if (score <= 0) {
				return true;
			}
			results.push({
				value: isDirectory ? `${displayPath}/` : displayPath,
				label: `${path.basename(displayPath)}${isDirectory ? "/" : ""}`,
				description: displayPath,
				isDirectory,
			});
			return true;
		},
		0,
		includeHidden,
		maxSearchDepth,
	);
	return results.sort(fileSuggestionComparator(scope.query)).slice(0, maxResults);
}

function fileSuggestionComparator(
	query: string,
): (a: FileSuggestion, b: FileSuggestion) => number {
	return (a, b) => {
		const scoreDiff =
			scoreFile(b.description, query) - scoreFile(a.description, query);
		if (scoreDiff !== 0) return scoreDiff;
		const depthDiff = pathDepth(a.description) - pathDepth(b.description);
		if (depthDiff !== 0) return depthDiff;
		if (a.isDirectory && !b.isDirectory) return -1;
		if (!a.isDirectory && b.isDirectory) return 1;
		return (
			a.description.length - b.description.length ||
			a.description.localeCompare(b.description)
		);
	};
}

function resolveFileSearchScope(workspacePath: string, query: string): FileSearchScope {
	const slashIndex = query.lastIndexOf("/");
	if (slashIndex === -1) {
		return { baseDir: workspacePath, displayBase: "", query };
	}
	const displayBase = query.slice(0, slashIndex + 1);
	const expandedBase = expandHomePath(displayBase);
	return {
		baseDir: path.resolve(workspacePath, expandedBase),
		displayBase,
		query: query.slice(slashIndex + 1),
	};
}

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function walkFiles(
	dir: string,
	visit: (entryPath: string, isDirectory: boolean) => boolean,
	depth = 0,
	includeHidden = false,
	maxSearchDepth = maxDepth,
): boolean {
	if (depth > maxSearchDepth) return true;
	let entries: Dirent[];
	try {
		entries = readdirSync(dir, { withFileTypes: true });
	} catch {
		return true;
	}
	entries.sort((a, b) => {
		if (a.isDirectory() && !b.isDirectory()) return -1;
		if (!a.isDirectory() && b.isDirectory()) return 1;
		return a.name.localeCompare(b.name);
	});
	for (const entry of entries) {
		if (
			entry.name === ".git" ||
			ignoredDirectoryNames.has(entry.name) ||
			(!includeHidden && isHiddenSegment(entry.name))
		) {
			continue;
		}
		const entryPath = path.join(dir, entry.name);
		if (!visit(entryPath, entry.isDirectory())) {
			return false;
		}
		if (
			entry.isDirectory() &&
			!walkFiles(entryPath, visit, depth + 1, includeHidden, maxSearchDepth)
		) {
			return false;
		}
	}
	return true;
}

function scoreFile(filePath: string, query: string): number {
	const lowerPath = filePath.toLowerCase();
	const lowerName = path.basename(filePath).toLowerCase();
	const lowerQuery = query.toLowerCase();
	if (!lowerQuery) return 1;
	if (lowerName === lowerQuery) return 100;
	if (lowerName.startsWith(lowerQuery)) return 80;
	if (lowerName.includes(lowerQuery)) return 50;
	if (lowerPath.includes(lowerQuery)) return 30;
	return fuzzyIncludes(lowerPath, lowerQuery) ? 10 : 0;
}

function pathDepth(filePath: string): number {
	return filePath.split("/").filter(Boolean).length;
}

function includesExplicitHiddenSegment(query: string): boolean {
	const segments = query.replaceAll("\\", "/").split("/");
	return segments.some(isHiddenSegment) || segments.at(-1) === ".";
}

function isHiddenSegment(segment: string): boolean {
	return segment.startsWith(".") && segment !== "." && segment !== "..";
}

function fuzzyIncludes(haystack: string, needle: string): boolean {
	let index = 0;
	for (const char of needle) {
		index = haystack.indexOf(char, index);
		if (index === -1) return false;
		index += 1;
	}
	return true;
}
