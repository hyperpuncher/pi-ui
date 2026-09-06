import type { FileTree, FileTreeBatchOperation } from "@pierre/trees";

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
	for (const path of [...before]
		.filter((path) => !after.has(path))
		.sort((a, b) => b.length - a.length)) {
		operations.push({ type: "remove", path });
	}
	if (operations.length > 0) tree.batch(operations);
}
