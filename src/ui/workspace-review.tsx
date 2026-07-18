import { preloadFileTree, serializeFileTreeSsrPayload } from "@pierre/trees";

import type { WorkspaceReviewSnapshot } from "../server/workspace-review.ts";

const treeOptions = {
	flattenEmptyDirectories: true,
	id: "review-file-tree",
	initialExpansion: "open" as const,
	initialVisibleRowCount: 20,
	search: false,
	stickyFolders: true,
	unsafeCSS:
		":host { --trees-padding-inline-override: 0px; } [data-item-git-status] > [data-item-section='content'] { color: var(--trees-fg); }",
};

export function renderWorkspaceReview(snapshot: WorkspaceReviewSnapshot): string {
	const tree = preloadFileTree({
		...treeOptions,
		gitStatus: snapshot.changes,
		paths: snapshot.changes.map((change) => change.path),
	});
	const additions = snapshot.changes.reduce(
		(total, change) => total + change.additions,
		0,
	);
	const deletions = snapshot.changes.reduce(
		(total, change) => total + change.deletions,
		0,
	);
	const initialData = JSON.stringify(snapshot).replaceAll("<", "\\u003c");

	return (
		<section
			id="workspace-review"
			class="border-border bg-background absolute inset-y-0 left-0 z-30 hidden min-h-0 w-1/2 min-w-0 grid-rows-[2.5rem_minmax(0,1fr)] border-r transition-[transform,opacity] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none max-[80rem]:w-full max-[80rem]:shadow-xl"
			style="display: none;"
			aria-label="Repository changes"
			aria-hidden="true"
		>
			<header class="border-border flex min-w-0 items-center justify-between gap-3 border-b px-3">
				<div class="flex min-w-0 items-center gap-2">
					<span class="text-sm font-medium">Changes</span>
					<span
						id="review-change-count"
						class="bg-muted text-muted-foreground rounded-full px-2 py-0.5 text-[11px] tabular-nums"
					>
						{snapshot.changes.length}
					</span>
					<span class="flex gap-1 font-mono text-[11px] tabular-nums">
						<span
							id="review-total-additions"
							class="text-emerald-600 dark:text-emerald-400"
						>
							+{additions}
						</span>
						<span id="review-total-deletions" class="text-destructive">
							-{deletions}
						</span>
					</span>
				</div>
				<div class="flex shrink-0 items-center gap-2">
					<div class="bg-muted flex rounded-md p-0.5" aria-label="Diff scope">
						<button
							id="review-mode-all"
							type="button"
							class="text-muted-foreground aria-pressed:bg-background aria-pressed:text-foreground rounded-sm px-2 py-1 text-xs font-medium aria-pressed:shadow-sm"
							aria-pressed="true"
						>
							All
						</button>
						<button
							id="review-mode-selected"
							type="button"
							class="text-muted-foreground aria-pressed:bg-background aria-pressed:text-foreground rounded-sm px-2 py-1 text-xs font-medium aria-pressed:shadow-sm"
							aria-pressed="false"
						>
							Selected
						</button>
					</div>
					<div class="bg-muted flex rounded-md p-0.5" aria-label="Diff layout">
						<button
							id="review-layout-split"
							type="button"
							class="text-muted-foreground aria-pressed:bg-background aria-pressed:text-foreground rounded-sm px-2 py-1 text-xs font-medium aria-pressed:shadow-sm"
							aria-pressed="true"
							aria-label="Split diff layout"
						>
							<svg
								class="size-3.5"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								aria-hidden="true"
							>
								<path d="M8 19H5c-1 0-2-1-2-2V7c0-1 1-2 2-2h3m8 0h3c1 0 2 1 2 2v10c0 1-1 2-2 2h-3M12 4v16" />
							</svg>
						</button>
						<button
							id="review-layout-stacked"
							type="button"
							class="text-muted-foreground aria-pressed:bg-background aria-pressed:text-foreground rounded-sm px-2 py-1 text-xs font-medium aria-pressed:shadow-sm"
							aria-pressed="false"
							aria-label="Stacked diff layout"
						>
							<svg
								class="size-3.5"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								stroke-linecap="round"
								stroke-linejoin="round"
								stroke-width="2"
								aria-hidden="true"
							>
								<path d="M5 8V5c0-1 1-2 2-2h10c1 0 2 1 2 2v3m0 8v3c0 1-1 2-2 2H7c-1 0-2-1-2-2v-3m-1-4h16" />
							</svg>
						</button>
					</div>
					<button
						id="review-wrap"
						type="button"
						class="text-muted-foreground aria-pressed:bg-muted aria-pressed:text-foreground rounded-sm px-2 py-1 text-xs font-medium"
						aria-pressed="true"
					>
						Wrap
					</button>
					<button
						type="button"
						class="btn text-muted-foreground hover:text-foreground"
						data-variant="ghost"
						data-size="icon-xs"
						data-on:click="window.piUi.workspaceReview.setOpen(false)"
						aria-label="Hide changes"
					>
						<svg
							class="size-3.5"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-linecap="round"
							stroke-linejoin="round"
							stroke-width="2"
							aria-hidden="true"
						>
							<path d="M18 6 6 18M6 6l12 12" />
						</svg>
					</button>
				</div>
			</header>

			<div class="grid min-h-0 min-w-0 grid-cols-[20rem_minmax(0,1fr)] max-[80rem]:grid-cols-[18rem_minmax(0,1fr)]">
				<aside class="border-border flex min-h-0 min-w-0 flex-col border-r">
					<div
						id="review-tree"
						class="min-h-0 flex-1 overflow-hidden [&>file-tree-container]:h-full [&>file-tree-container]:min-h-0 [&>file-tree-container]:w-full"
						style="--trees-bg-override: transparent; --trees-border-color-override: var(--border); --trees-fg-override: var(--foreground); --trees-selected-bg-override: var(--muted);"
					>
						{serializeFileTreeSsrPayload(tree)}
					</div>
				</aside>

				<div class="relative min-h-0 min-w-0">
					<div
						id="review-diff-view"
						class="absolute inset-0 overflow-x-clip overflow-y-auto overscroll-contain"
						aria-label="Code changes"
					/>
					<div
						id="review-empty"
						class="text-muted-foreground pointer-events-none absolute inset-0 grid place-items-center px-6 text-center text-sm"
					>
						{snapshot.isGitRepository
							? snapshot.changes.length === 0
								? "Working tree clean"
								: "Loading changes…"
							: "Open a Git repository to review changes"}
					</div>
				</div>
			</div>
			<script id="workspace-review-data" type="application/json">
				{initialData}
			</script>
		</section>
	) as string;
}
