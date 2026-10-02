import type { FileTree, FileTreeBatchOperation } from "@pierre/trees";

import { isBoolean, isRecord } from "../utils/type-guards.ts";

function pathsWithAncestors(paths: readonly string[]): Set<string> {
	const result = new Set(paths);
	for (const path of paths) {
		for (
			let index = path.indexOf("/");
			index !== -1;
			index = path.indexOf("/", index + 1)
		) {
			result.add(path.slice(0, index + 1));
		}
	}
	return result;
}

type TreeExpansion = Record<string, boolean>;

/** Remember expansion per workspace and panel for this browser tab. */
export function createWorkspaceTreeExpansion(
	tree: FileTree,
	panel: "files" | "git",
	getWorkspacePath: () => string,
	storage?: Pick<Storage, "getItem" | "setItem">,
) {
	let directories = new Set<string>();
	const storageKey = () => `pi-ui:tree-expansion:${panel}:${getWorkspacePath()}`;

	function sync(
		previous: readonly string[] | undefined,
		next: readonly string[],
	): void {
		syncWorkspaceTreePaths(tree, previous, next);
		directories = new Set(
			[...pathsWithAncestors(next)].filter((path) => path.endsWith("/")),
		);
		if (previous) return;
		try {
			const saved: unknown = JSON.parse(
				(storage ?? window.sessionStorage).getItem(storageKey()) ?? "null",
			);
			if (!isRecord(saved)) return;
			// Expanding a child opens its ancestors, so restore parents last.
			for (const [path, expanded] of Object.entries(saved).toSorted(
				([a], [b]) => b.length - a.length,
			)) {
				const item = tree.getItem(path);
				if (!isBoolean(expanded) || !item || !("expand" in item)) continue;
				if (expanded) item.expand();
				else item.collapse();
			}
		} catch {
			// Storage can be unavailable or contain an invalid old value.
		}
	}

	function save(): void {
		if (directories.size === 0) return;
		// Saving happens only when leaving. Let Pierre undo temporary search expansion.
		tree.closeSearch();
		const expansion: TreeExpansion = {};
		for (const path of directories) {
			const item = tree.getItem(path);
			if (item && "isExpanded" in item) expansion[path] = item.isExpanded();
		}
		try {
			(storage ?? window.sessionStorage).setItem(
				storageKey(),
				JSON.stringify(expansion),
			);
		} catch {
			// Folder persistence must not prevent navigation when storage is unavailable.
		}
	}

	return { sync, save };
}

/** Keep surviving folders and their expansion state when workspace paths change. */
export function syncWorkspaceTreePaths(
	tree: FileTree,
	previous: readonly string[] | undefined,
	next: readonly string[],
): void {
	if (!previous) {
		tree.resetPaths(next);
		return;
	}
	if (
		previous.length === next.length &&
		previous.every((path, index) => path === next[index])
	)
		return;
	const before = pathsWithAncestors(previous);
	const after = pathsWithAncestors(next);
	const operations: FileTreeBatchOperation[] = [];
	// Add first so replacing a folder's last file does not recreate the folder.
	for (const path of next) {
		if (!before.has(path)) operations.push({ type: "add", path });
	}
	// Remove children before parents, including implicitly created folders.
	for (const path of [...before.difference(after)].toSorted(
		(a, b) => b.length - a.length,
	)) {
		operations.push({ type: "remove", path });
	}
	if (operations.length > 0) tree.batch(operations);
}
