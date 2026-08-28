import { readdir } from "node:fs/promises";
import * as path from "node:path";

import { expandHomePath } from "../utils/workspace.ts";

export type WorkspaceSuggestion = {
	path: string;
};

export type WorkspaceDirectoryListing = {
	path: string;
	parent?: string;
	directories: string[];
	showHidden: boolean;
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
		for (const entry of await readdir(directory, { withFileTypes: true })) {
			if (
				!entry.isDirectory() ||
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

export async function browseWorkspaceDirectories(
	workspacePath: string,
	value: string,
	showHidden: boolean,
): Promise<WorkspaceDirectoryListing> {
	const expanded = expandHomePath(value.trim() || workspacePath);
	const directory = path.isAbsolute(expanded)
		? path.normalize(expanded)
		: path.resolve(workspacePath, expanded);
	const entries = await readdir(directory, { withFileTypes: true });
	const parent = path.dirname(directory);
	return {
		path: directory,
		parent: parent === directory ? undefined : parent,
		directories: entries
			.filter(
				(entry) =>
					entry.isDirectory() && (showHidden || !entry.name.startsWith(".")),
			)
			.map((entry) => path.join(directory, entry.name))
			.sort((left, right) => left.localeCompare(right)),
		showHidden,
	};
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
