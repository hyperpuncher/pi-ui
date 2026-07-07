import * as path from "node:path";

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

export class FileSearchHost {
	private constructor(readonly workspacePath: string) {}

	static create(workspacePath: string): FileSearchHost {
		return new FileSearchHost(workspacePath);
	}

	async search(query: string): Promise<FileSuggestion[]> {
		const normalizedQuery = query.replaceAll("\\", "/").replace(/^@/, "");
		return (
			(await searchWithFd(this.workspacePath, normalizedQuery)) ??
			searchManually(this.workspacePath, normalizedQuery)
		);
	}

	dispose(): void {}
}

async function searchWithFd(
	workspacePath: string,
	query: string,
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
		output = await new Deno.Command("fd", { args }).output();
	} catch {
		return undefined;
	}
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

function searchManually(workspacePath: string, query: string): FileSuggestion[] {
	const scoped = resolveFileSearchScope(workspacePath, query);
	const results: FileSuggestion[] = [];
	let scanned = 0;
	walkFiles(scoped.baseDir, (entryPath, isDirectory) => {
		if (scanned > maxScanned || results.length >= maxCollected) {
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
		.slice(0, maxResults);
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
	const scopedBase = path.resolve(workspacePath, displayBase);
	if (!isInside(workspacePath, scopedBase)) {
		return { baseDir: workspacePath, displayBase: "", query: "" };
	}
	return { baseDir: scopedBase, displayBase, query: query.slice(slashIndex + 1) };
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

function isInside(parent: string, child: string): boolean {
	const relative = path.relative(parent, child);
	return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}
