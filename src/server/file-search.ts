import * as path from "node:path";

import { expandHomePath } from "../utils/workspace.ts";

export type FileSuggestion = {
	value: string;
	label: string;
	description: string;
	isDirectory: boolean;
};

const maxDepth = 0;
const maxScanned = 5_000;
const maxCollected = 30;
const maxResults = 20;
const fdMaxResults = 100;

export type FileSearchCommand = (
	args: string[],
	signal?: AbortSignal,
) => Promise<Deno.CommandOutput>;

const runFd: FileSearchCommand = (args, signal) =>
	new Deno.Command("fd", { args, signal }).output();

export async function searchFiles(
	workspacePath: string,
	query: string,
	signal?: AbortSignal,
	command: FileSearchCommand = runFd,
): Promise<FileSuggestion[]> {
	const normalizedQuery = query.replaceAll("\\", "/").replace(/^@/, "");
	const fdResults = await searchWithFd(workspacePath, normalizedQuery, signal, command);
	if (fdResults !== undefined) {
		if (fdResults.length > 0 || !normalizedQuery) return fdResults;
		return findClosestFiles(
			(await searchWithFd(
				workspacePath,
				parentQuery(normalizedQuery),
				signal,
				command,
				fdMaxResults,
			)) ?? [],
			normalizedQuery,
		);
	}
	signal?.throwIfAborted();
	const manualResults = searchManually(workspacePath, normalizedQuery);
	if (manualResults.length > 0) return manualResults;
	return findClosestFiles(
		searchManually(
			workspacePath,
			parentQuery(normalizedQuery),
			fdMaxResults,
			maxScanned,
		),
		normalizedQuery,
	);
}

async function searchWithFd(
	workspacePath: string,
	query: string,
	signal: AbortSignal | undefined,
	command: FileSearchCommand,
	limit = maxResults,
): Promise<FileSuggestion[] | undefined> {
	const scoped = resolveFileSearchScope(workspacePath, query);
	const args = [
		"--base-directory",
		scoped.baseDir,
		"--max-results",
		String(fdMaxResults),
		"--max-depth",
		"1",
		"--type",
		"f",
		"--type",
		"d",
		"--follow",
		"--hidden",
		"--exclude",
		".git",
		"--exclude",
		".git/*",
		"--exclude",
		".git/**",
	];
	if (scoped.query) {
		args.push(buildFdPathQuery(scoped.query));
	}

	let output: Deno.CommandOutput;
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
		.map((line) => toSuggestion(scoped.displayBase, line))
		.filter((item) => !item.description.startsWith(".git/"))
		.sort((a, b) => {
			const scoreDiff =
				scoreFile(b.description, scoped.query, b.isDirectory) -
				scoreFile(a.description, scoped.query, a.isDirectory);
			if (scoreDiff !== 0) return scoreDiff;
			if (a.isDirectory && !b.isDirectory) return -1;
			if (!a.isDirectory && b.isDirectory) return 1;
			return a.description.localeCompare(b.description);
		})
		.slice(0, limit);
}

function parentQuery(query: string): string {
	const slashIndex = query.lastIndexOf("/");
	return slashIndex === -1 ? "" : query.slice(0, slashIndex + 1);
}

function findClosestFiles(
	items: readonly FileSuggestion[],
	query: string,
): FileSuggestion[] {
	const name = query.slice(query.lastIndexOf("/") + 1).toLowerCase();
	if (!name) return [];
	return [...items]
		.sort((a, b) => {
			const aName = path.basename(a.description).toLowerCase();
			const bName = path.basename(b.description).toLowerCase();
			const distanceDiff = editDistance(aName, name) - editDistance(bName, name);
			if (distanceDiff !== 0) return distanceDiff;
			const lengthDiff =
				Math.abs(aName.length - name.length) -
				Math.abs(bName.length - name.length);
			return lengthDiff || a.description.localeCompare(b.description);
		})
		.slice(0, maxResults);
}

function editDistance(left: string, right: string): number {
	let previous = Array.from({ length: right.length + 1 }, (_, index) => index);
	for (let leftIndex = 0; leftIndex < left.length; leftIndex += 1) {
		const current = [leftIndex + 1];
		for (let rightIndex = 0; rightIndex < right.length; rightIndex += 1) {
			current.push(
				Math.min(
					current[rightIndex] + 1,
					previous[rightIndex + 1] + 1,
					previous[rightIndex] +
						(left[leftIndex] === right[rightIndex] ? 0 : 1),
				),
			);
		}
		previous = current;
	}
	return previous[right.length];
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
	workspacePath: string,
	query: string,
	limit = maxResults,
	collectionLimit = maxCollected,
): FileSuggestion[] {
	const scoped = resolveFileSearchScope(workspacePath, query);
	const results: FileSuggestion[] = [];
	let scanned = 0;
	walkFiles(scoped.baseDir, (entryPath, isDirectory) => {
		if (scanned > maxScanned || results.length >= collectionLimit) {
			return false;
		}
		scanned += 1;
		const relative = path.relative(scoped.baseDir, entryPath).replaceAll("\\", "/");
		if (!relative || relative.startsWith(".git/")) {
			return true;
		}
		const displayPath = scoped.displayBase
			? `${scoped.displayBase}${relative}`
			: relative;
		const score = scoreFile(displayPath, scoped.query, isDirectory);
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
	});
	return results
		.sort((a, b) => {
			const scoreDiff =
				scoreFile(b.description, scoped.query, b.isDirectory) -
				scoreFile(a.description, scoped.query, a.isDirectory);
			if (scoreDiff !== 0) return scoreDiff;
			if (a.isDirectory && !b.isDirectory) return -1;
			if (!a.isDirectory && b.isDirectory) return 1;
			return a.description.localeCompare(b.description);
		})
		.slice(0, limit);
}

function resolveFileSearchScope(
	workspacePath: string,
	query: string,
): { baseDir: string; displayBase: string; query: string } {
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

function buildFdPathQuery(query: string): string {
	if (!query.includes("/")) {
		return query;
	}
	const hasTrailingSeparator = query.endsWith("/");
	const segments = query
		.replace(/^\/+|\/+$/g, "")
		.split("/")
		.filter(Boolean)
		.map(escapeRegex);
	let pattern = segments.join("[\\\\/]");
	if (hasTrailingSeparator) {
		pattern += "[\\\\/]";
	}
	return pattern;
}

function escapeRegex(value: string): string {
	return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function walkFiles(
	dir: string,
	visit: (entryPath: string, isDirectory: boolean) => boolean,
	depth = 0,
): boolean {
	if (depth > maxDepth) return true;
	let entries: Deno.DirEntry[];
	try {
		entries = [...Deno.readDirSync(dir)];
	} catch {
		return true;
	}
	entries.sort((a, b) => {
		if (a.isDirectory && !b.isDirectory) return -1;
		if (!a.isDirectory && b.isDirectory) return 1;
		return a.name.localeCompare(b.name);
	});
	for (const entry of entries) {
		if (entry.name === ".git" || entry.name === "node_modules") {
			continue;
		}
		const entryPath = path.join(dir, entry.name);
		if (!visit(entryPath, entry.isDirectory)) {
			return false;
		}
		if (entry.isDirectory && !walkFiles(entryPath, visit, depth + 1)) {
			return false;
		}
	}
	return true;
}

function scoreFile(filePath: string, query: string, isDirectory: boolean): number {
	const lowerPath = filePath.toLowerCase();
	const lowerName = path.basename(filePath).toLowerCase();
	const lowerQuery = query.toLowerCase();
	let score = 0;
	if (!lowerQuery) score = 1;
	else if (lowerName === lowerQuery) score = 100;
	else if (lowerName.startsWith(lowerQuery)) score = 80;
	else if (lowerName.includes(lowerQuery)) score = 50;
	else if (lowerPath.includes(lowerQuery)) score = 30;
	else if (fuzzyIncludes(lowerPath, lowerQuery)) score = 10;
	return isDirectory && score > 0 ? score + 10 : score;
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
