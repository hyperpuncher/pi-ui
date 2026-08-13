import { prepareFileTreeInput } from "@pierre/trees";

export function sortWorkspaceReviewEntries<T extends Readonly<{ path: string }>>(
	entries: readonly T[],
): T[] {
	const entriesByPath = new Map(entries.map((entry) => [entry.path, entry]));
	return prepareFileTreeInput(entries.map((entry) => entry.path)).paths.map(
		(path) => entriesByPath.get(path)!,
	);
}

export const workspaceReviewTreeOptions = {
	density: "compact" as const,
	fileTreeSearchMode: "hide-non-matches" as const,
	flattenEmptyDirectories: true,
	id: "review-file-tree",
	initialExpansion: "open" as const,
	initialVisibleRowCount: 20,
	search: true,
	searchBlurBehavior: "retain" as const,
	stickyFolders: false,
	unsafeCSS:
		"svg[data-icon-sprite] { position: absolute; } [data-item-git-status] > [data-item-section='content'] { color: var(--trees-fg); } [data-file-tree-virtualized-sticky='true'] { will-change: auto; }",
};
