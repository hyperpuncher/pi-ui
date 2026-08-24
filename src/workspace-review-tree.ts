import { prepareFileTreeInput } from "@pierre/trees";

export function sortWorkspaceReviewEntries<T extends Readonly<{ path: string }>>(
	entries: readonly T[],
): T[] {
	const entriesByPath = new Map(entries.map((entry) => [entry.path, entry]));
	return prepareFileTreeInput(entries.map((entry) => entry.path)).paths.map((path) =>
		entriesByPath.get(path)!,
	);
}

export const workspaceTreeStyle = [
	"--trees-bg-override: var(--pi-surface-raised)",
	"--trees-bg-muted-override: var(--pi-hover-background)",
	"--trees-border-color-override: transparent",
	"--trees-fg-override: var(--foreground)",
	"--trees-font-family-override: var(--font-sans)",
	"--trees-focus-ring-color-override: var(--muted-foreground)",
	"--trees-padding-inline-override: 8px",
	"--trees-scrollbar-gutter-override: 4px",
	"--trees-search-bg-override: var(--pi-tree-search-background)",
	"--trees-selected-bg-override: var(--pi-selection-background)",
	"--trees-selected-focused-border-color-override: var(--muted-foreground)",
].join("; ");

// Pierre has no host variables for neutral labels beside colored Git badges
// or for disabling sticky-row layer promotion, which blurs text in this panel.
export const workspaceTreeUnsafeCss = `
	[data-item-git-status] > [data-item-section='content'] { color: var(--trees-fg); }
	[data-file-tree-virtualized-sticky='true'] { will-change: auto; }
`;

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
	unsafeCSS: workspaceTreeUnsafeCss,
};
