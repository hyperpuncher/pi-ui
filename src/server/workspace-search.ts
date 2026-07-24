import * as path from "node:path";

import { expandHomePath } from "../utils/workspace.ts";

export type WorkspaceSuggestion = {
	path: string;
};

const maxResults = 20;

export async function searchWorkspaces(
	workspacePath: string,
	query: string,
): Promise<WorkspaceSuggestion[]> {
	const value = query.trim();
	if (!value) return [];

	const expanded = expandHomePath(value);
	const target = path.isAbsolute(expanded)
		? expanded
		: path.resolve(workspacePath, expanded);
	const trailingSeparator = target.endsWith(path.sep);
	const directory = trailingSeparator ? target : path.dirname(target);
	const prefix = trailingSeparator ? "" : path.basename(target).toLowerCase();

	try {
		const suggestions: WorkspaceSuggestion[] = [];
		for await (const entry of Deno.readDir(directory)) {
			if (
				!entry.isDirectory ||
				(!prefix.startsWith(".") && entry.name.startsWith("."))
			) {
				continue;
			}
			if (!entry.name.toLowerCase().includes(prefix)) continue;
			suggestions.push({ path: path.join(directory, entry.name) });
		}
		return suggestions
			.sort((left, right) => compareWorkspacePaths(left.path, right.path, prefix))
			.slice(0, maxResults);
	} catch {
		return [];
	}
}

function compareWorkspacePaths(left: string, right: string, prefix: string): number {
	const leftName = path.basename(left).toLowerCase();
	const rightName = path.basename(right).toLowerCase();
	const leftStartsWithPrefix = leftName.startsWith(prefix);
	const rightStartsWithPrefix = rightName.startsWith(prefix);
	if (leftStartsWithPrefix !== rightStartsWithPrefix) {
		return leftStartsWithPrefix ? -1 : 1;
	}
	return left.localeCompare(right);
}
