import type { FileTree, FileTreeBatchOperation } from "@pierre/trees";

/** Keep existing folders and their expansion state when workspace paths change. */
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
	const before = new Set(previous);
	const after = new Set(next);
	const operations: FileTreeBatchOperation[] = [];
	// Add first so replacing a folder's last file does not recreate the folder.
	for (const path of next) {
		if (!before.has(path)) operations.push({ type: "add", path });
	}
	// Remove children before their explicitly listed parent folders.
	for (const path of previous
		.filter((path) => !after.has(path))
		.sort((a, b) => b.length - a.length)) {
		operations.push({ type: "remove", path });
	}
	if (operations.length > 0) tree.batch(operations);
}
