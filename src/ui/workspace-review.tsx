import { preloadFileTree, serializeFileTreeSsrPayload } from "@pierre/trees";

import type { WorkspaceReviewSnapshot } from "../server/workspace-review.ts";
import { workspaceReviewTreeOptions } from "../workspace-review-tree.ts";

export function renderWorkspaceReview(snapshot: WorkspaceReviewSnapshot): string {
	const tree = preloadFileTree({
		...workspaceReviewTreeOptions,
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
			class="absolute inset-y-0 left-0 z-30 hidden min-h-0 min-w-0 grid-cols-[minmax(0,1fr)_var(--pi-workspace-structural-gap)] transition-[transform,opacity] duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none max-[80rem]:w-full max-[80rem]:shadow-xl"
			style="display: none; width: 50%;"
			aria-label="Git"
			aria-hidden="true"
		>
			<div id="review-body" class="pi-review-body grid min-h-0 min-w-0">
				<aside class="pi-review-sidebar flex min-h-0 min-w-0 flex-col">
					<section
						id="review-changes-section"
						class="pi-raised-surface flex min-h-0 shrink-0 flex-col overflow-hidden"
					>
						<button
							id="review-working-tree"
							type="button"
							class="flex h-8 shrink-0 items-center gap-2 px-3 text-left text-xs font-medium"
							aria-pressed="true"
						>
							<span>Changes</span>
							<span
								id="review-change-count"
								class="bg-muted text-muted-foreground rounded-full px-1.5 py-0.5 text-[10px] tabular-nums"
							>
								{snapshot.changes.length}
							</span>
							<span class="ml-auto flex gap-1 font-mono text-[10px] tabular-nums">
								<span
									id="review-total-additions"
									class="text-[var(--pi-success)]"
								>
									+{additions}
								</span>
								<span
									id="review-total-deletions"
									class="text-destructive"
								>
									-{deletions}
								</span>
							</span>
						</button>
						<div
							id="review-tree"
							class="min-h-0 flex-1 overflow-hidden [&>file-tree-container]:h-full [&>file-tree-container]:min-h-0 [&>file-tree-container]:w-full"
							style="--trees-bg-override: transparent; --trees-border-color-override: transparent; --trees-fg-override: var(--foreground); --trees-font-family-override: var(--font-sans); --trees-padding-inline-override: 8px; --trees-scrollbar-gutter-override: 4px; --trees-selected-bg-override: var(--pi-surface-subtle);"
						>
							{serializeFileTreeSsrPayload(tree)}
						</div>
						<div
							id="review-tree-empty"
							class="text-muted-foreground px-3 pb-2 text-xs"
							style={
								snapshot.changes.length > 0 ? "display: none" : undefined
							}
						>
							Working tree clean
						</div>
					</section>
					<div
						id="review-changes-separator"
						class="pi-resize-handle shrink-0"
						data-orientation="horizontal"
						role="separator"
						tabindex="0"
						aria-label="Resize Changes and History"
						aria-orientation="horizontal"
					/>
					<section class="pi-raised-surface flex min-h-0 flex-1 flex-col overflow-hidden">
						<header class="flex h-8 shrink-0 items-center px-3 text-xs font-medium">
							History
						</header>
						<div
							id="review-history"
							class="min-h-0 flex-1 overflow-y-auto overscroll-contain px-1 pb-1"
							aria-label="Commit history"
						>
							<p class="text-muted-foreground px-2 py-1 text-xs">
								Loading history…
							</p>
						</div>
					</section>
				</aside>

				<div
					id="review-sidebar-separator"
					class="pi-resize-handle"
					role="separator"
					tabindex="0"
					aria-label="Resize file sidebar"
					aria-orientation="vertical"
				/>

				<div class="flex min-h-0 min-w-0 flex-col">
					<header class="pi-review-toolbar flex min-w-0 shrink-0 items-center justify-between gap-2 px-1">
						<span
							id="review-branch"
							class="text-muted-foreground min-w-0 truncate font-mono text-[11px]"
							style={snapshot.branch ? undefined : "display: none"}
							safe
						>
							{snapshot.branch ?? ""}
						</span>
						<div class="pi-review-controls flex shrink-0 items-center gap-1">
							<div
								class="flex rounded-md bg-[var(--pi-control-well)] p-0.5"
								aria-label="Diff scope"
							>
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
							<div
								class="flex rounded-md bg-[var(--pi-control-well)] p-0.5"
								aria-label="Diff layout"
							>
								<button
									id="review-layout-split"
									type="button"
									class="text-muted-foreground aria-pressed:bg-background aria-pressed:text-foreground rounded-sm p-1 text-xs font-medium aria-pressed:shadow-sm"
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
									class="text-muted-foreground aria-pressed:bg-background aria-pressed:text-foreground rounded-sm p-1 text-xs font-medium aria-pressed:shadow-sm"
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
								class="text-muted-foreground aria-pressed:text-foreground rounded-sm px-2 py-1 text-xs font-medium aria-pressed:bg-[var(--pi-control-well)]"
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
								aria-label="Hide Git"
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
					<header id="review-detail-header" class="hidden shrink-0 px-3 py-2" />
					<div class="pi-review-diff-canvas relative min-h-0 min-w-0 flex-1">
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
								? "Loading Git data…"
								: "Open a Git repository"}
						</div>
					</div>
				</div>
			</div>
			<div
				id="review-git-separator"
				class="pi-resize-handle"
				role="separator"
				tabindex="0"
				aria-label="Resize Git and chat"
				aria-orientation="vertical"
			/>
			<script id="workspace-review-data" type="application/json">
				{initialData}
			</script>
		</section>
	) as string;
}
