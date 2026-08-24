import { workspaceTreeStyle } from "../workspace-review-tree.ts";
import {
	changesRatioDefault,
	changesRatioMax,
	changesRatioMin,
	gitPaneRatioDefault,
	gitPaneRatioMax,
	gitPaneRatioMin,
	reviewSidebarWidthDefault,
	reviewSidebarWidthMax,
	reviewSidebarWidthMin,
	type WorkspaceReviewPreferences,
	type WorkspaceReviewSnapshot,
} from "../workspace-review-types.ts";
import { altShortcutAction, ShortcutKbd } from "./keyboard.tsx";
import { syncHtml } from "./sync-html.ts";

type ResizePreference = "changesRatio" | "gitPaneRatio" | "reviewSidebarWidth";

function resizeHandleAttributes(options: {
	axis: "horizontal" | "vertical";
	defaultValue: number;
	maximum: number;
	minimum: number;
	preference: ResizePreference;
	scale: string;
}) {
	const coordinate = options.axis === "horizontal" ? "clientX" : "clientY";
	const decrease = options.axis === "horizontal" ? "ArrowLeft" : "ArrowUp";
	const increase = options.axis === "horizontal" ? "ArrowRight" : "ArrowDown";
	const value = `$workspaceReviewPreferences.${options.preference}`;
	const normalize = `${value} = Math.min(
		${options.maximum},
		Math.max(${options.minimum}, ${value} ?? ${options.defaultValue}),
	);`;
	const commit = `document.body.dispatchEvent(new CustomEvent(
		'pi-ui-workspace-review-preferences',
		{ detail: { ${options.preference}: ${value} } },
	));`;
	const finish = `if (el.hasPointerCapture(evt.pointerId)) {
		${normalize}
		document.documentElement.classList.remove('pi-resizing');
		${commit}
	}`;
	return {
		"data-on:pointerdown": `if (evt.button === 0) {
			el.dataset.resizePointer = evt.${coordinate};
			el.dataset.resizeScale = ${options.scale};
			el.dataset.resizeStart = ${value} ?? ${options.defaultValue};
			el.setPointerCapture(evt.pointerId);
			document.documentElement.classList.add('pi-resizing');
		}`,
		"data-on:pointermove__throttle.8ms": `if (el.hasPointerCapture(evt.pointerId)) {
			${value} = Number(el.dataset.resizeStart) +
				(evt.${coordinate} - Number(el.dataset.resizePointer)) /
				Number(el.dataset.resizeScale);
		}`,
		"data-on:pointerup": finish,
		"data-on:pointercancel": finish,
		"data-on:dblclick": `${value} = ${options.defaultValue}; ${commit}`,
		"data-on:keydown": `if (evt.code === '${decrease}' || evt.code === '${increase}') {
			evt.preventDefault();
			const direction = evt.code === '${decrease}' ? -1 : 1;
			${value} = (${value} ?? ${options.defaultValue}) +
				direction * (evt.shiftKey ? 48 : 16) / (${options.scale});
			${normalize}
			${commit}
		}`,
	};
}

export function renderWorkspaceReview(
	workspacePath: string,
	filesRevision: number,
	snapshot: WorkspaceReviewSnapshot,
	preferences: WorkspaceReviewPreferences,
): string {
	const additions = snapshot.changes.reduce(
		(total, change) => total + change.additions,
		0,
	);
	const deletions = snapshot.changes.reduce(
		(total, change) => total + change.deletions,
		0,
	);
	return syncHtml(
		<section
			id="workspace-review"
			class="z-30 min-h-0 min-w-0"
			aria-label="Workspace"
			aria-keyshortcuts="Alt+E Alt+F Alt+G"
			aria-hidden="true"
			inert
			data-on:keydown__window={`${altShortcutAction(
				"KeyF",
				"window.piUi.workspaceReview.focusFiles();",
			)}
			${altShortcutAction("KeyG", "window.piUi.workspaceReview.focusGit();")}
			${altShortcutAction("KeyE", "window.piUi.workspaceReview.focusEditor();")}`}
			data-attr:aria-hidden="$_workspaceReviewOpen ? 'false' : 'true'"
			data-attr:inert="!$_workspaceReviewOpen"
		>
			<div id="review-body" class="pi-review-body grid min-h-0 min-w-0">
				<aside
					id="workspace-files-sidebar"
					class="pi-review-sidebar flex min-h-0 min-w-0 flex-col"
					style={
						snapshot.isGitRepository && preferences.tab !== "files"
							? "display: none"
							: undefined
					}
					data-show="!$_workspaceReviewGitAvailable || $workspaceReviewPreferences.tab === 'files'"
				>
					{renderWorkspaceModeHeader("files", snapshot.isGitRepository)}
					<section class="pi-raised-surface flex min-h-0 flex-1 flex-col overflow-hidden">
						<div
							id="workspace-file-tree"
							class="min-h-0 flex-1 overflow-hidden pt-1 outline-none [&>file-tree-container]:h-full [&>file-tree-container]:min-h-0 [&>file-tree-container]:w-full"
							aria-label="Workspace files"
							tabindex="-1"
						/>
					</section>
				</aside>

				<aside
					id="review-git-sidebar"
					class="pi-review-sidebar grid min-h-0 min-w-0 flex-col"
					style={
						!snapshot.isGitRepository || preferences.tab === "files"
							? "display: none"
							: undefined
					}
					data-show="
						$_workspaceReviewGitAvailable &&
						$workspaceReviewPreferences.tab !== 'files'
					"
				>
					{renderWorkspaceModeHeader("git", snapshot.isGitRepository)}
					<section
						id="review-changes-section"
						class="pi-raised-surface flex min-h-0 shrink-0 flex-col overflow-hidden"
						hidden={snapshot.changes.length === 0}
						data-attr:hidden="!$_workspaceReviewHasChanges"
					>
						<header class="flex h-8 shrink-0 items-center gap-2 px-3 text-xs font-medium">
							<span>Changes</span>
							<span
								id="review-change-count"
								class="pi-fine-print rounded-full bg-muted px-1.5 py-0.5 text-[10px] tabular-nums"
								data-text="$_workspaceReviewChangeCount"
							>
								{snapshot.changes.length}
							</span>
							<span class="ml-auto flex gap-1 font-mono text-[10px] tabular-nums">
								<span
									id="review-total-additions"
									class="text-(--pi-diff-addition)"
									data-text="'+' + $_workspaceReviewAdditions"
								>
									+{additions}
								</span>
								<span
									id="review-total-deletions"
									class="text-(--pi-diff-deletion)"
									data-text="'-' + $_workspaceReviewDeletions"
								>
									-{deletions}
								</span>
							</span>
						</header>
						<div
							id="review-tree"
							class="min-h-0 flex-1 overflow-hidden pt-1 outline-none [&>file-tree-container]:h-full [&>file-tree-container]:min-h-0 [&>file-tree-container]:w-full"
							style={workspaceTreeStyle}
							aria-label="Git changes"
							tabindex="-1"
							data-show="$_workspaceReviewHasChanges"
						/>
						<div
							id="review-tree-empty"
							class="px-3 pb-2 text-xs text-muted-foreground"
							style={
								snapshot.changes.length > 0 ? "display: none" : undefined
							}
							data-show="!$_workspaceReviewHasChanges"
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
						hidden={snapshot.changes.length === 0}
						data-attr:hidden="!$_workspaceReviewHasChanges"
						aria-label="Resize Changes and History"
						aria-orientation="horizontal"
						aria-valuemin={changesRatioMin * 100}
						aria-valuemax={changesRatioMax * 100}
						data-attr:aria-valuenow={`Math.round(($workspaceReviewPreferences.changesRatio ?? ${changesRatioDefault}) * 100)`}
						attrs={resizeHandleAttributes({
							axis: "vertical",
							defaultValue: changesRatioDefault,
							maximum: changesRatioMax,
							minimum: changesRatioMin,
							preference: "changesRatio",
							scale: "Math.max(1, el.parentElement.clientHeight - el.parentElement.firstElementChild.offsetHeight - el.offsetHeight)",
						})}
					/>
					<section class="pi-raised-surface flex min-h-0 flex-1 flex-col overflow-hidden">
						<header class="flex h-8 shrink-0 items-center px-3 text-xs font-medium">
							History
						</header>
						<div
							id="review-history"
							class="min-h-0 flex-1 space-y-px overflow-y-auto overscroll-contain px-1 pb-1"
							aria-label="Commit history"
						>
							<p class="px-2 py-1 text-xs text-muted-foreground">
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
					aria-valuemin={reviewSidebarWidthMin}
					aria-valuemax={reviewSidebarWidthMax}
					data-attr:aria-valuenow={`$workspaceReviewPreferences.reviewSidebarWidth ?? ${reviewSidebarWidthDefault}`}
					attrs={resizeHandleAttributes({
						axis: "horizontal",
						defaultValue: reviewSidebarWidthDefault,
						maximum: reviewSidebarWidthMax,
						minimum: reviewSidebarWidthMin,
						preference: "reviewSidebarWidth",
						scale: "1",
					})}
				/>

				<div
					id="workspace-file-main"
					class="flex min-h-0 min-w-0 flex-col outline-none"
					aria-label="File editor"
					aria-keyshortcuts="Alt+E"
					tabindex="-1"
					style={
						snapshot.isGitRepository && preferences.tab !== "files"
							? "display: none"
							: undefined
					}
					data-show="!$_workspaceReviewGitAvailable || $workspaceReviewPreferences.tab === 'files'"
				>
					<header class="pi-review-toolbar flex min-w-0 shrink-0 items-center gap-2 px-1">
						<div class="flex min-w-0 flex-1 items-center gap-2 font-mono text-[11px]">
							<span
								id="workspace-file-path"
								class="pi-fine-print min-w-0 truncate"
							>
								Select a file
							</span>
							<span
								id="workspace-file-status"
								class="pi-fine-print shrink-0 tabular-nums"
							/>
						</div>
						<ShortcutKbd shortcut="alt E" />
						<div class="flex rounded-md bg-(--pi-control-well) p-0.5">
							<button
								id="workspace-file-wrap"
								type="button"
								class="rounded-sm p-1 text-xs font-medium text-muted-foreground aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm"
								aria-pressed="true"
								aria-label="Wrap long lines"
								data-tooltip="Wrap long lines"
								data-side="bottom"
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
									<path d="m16 16-3 3 3 3" />
									<path d="M3 12h14.5a1 1 0 0 1 0 7H13M3 19h6M3 5h18" />
								</svg>
							</button>
						</div>
						<button
							id="workspace-file-edit"
							type="button"
							class="btn"
							data-variant="ghost"
							data-size="xs"
							disabled
						>
							Save
						</button>
						<button
							type="button"
							class="btn text-muted-foreground hover:text-foreground"
							data-variant="ghost"
							data-size="icon-xs"
							data-on:click="$_workspaceReviewOpen = false"
							aria-label="Hide workspace"
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
					</header>
					<div class="pi-review-diff-canvas relative min-h-0 min-w-0 flex-1">
						<div
							id="workspace-file-view"
							class="absolute inset-0 overflow-auto overscroll-contain outline-none"
							aria-label="File contents"
							aria-keyshortcuts="Alt+E"
							tabindex="-1"
						/>
						<div
							id="workspace-file-empty"
							class="pointer-events-none absolute inset-0 grid place-items-center px-6 text-center text-sm text-muted-foreground"
						>
							Open a file from the workspace
						</div>
					</div>
				</div>

				<div
					id="review-git-main"
					class="flex min-h-0 min-w-0 flex-col"
					style={
						!snapshot.isGitRepository || preferences.tab === "files"
							? "display: none"
							: undefined
					}
					data-show="$_workspaceReviewGitAvailable && $workspaceReviewPreferences.tab !== 'files'"
				>
					<header class="pi-review-toolbar flex min-w-0 shrink-0 items-center justify-between gap-2 px-1">
						<span
							id="review-branch"
							class="pi-fine-print min-w-0 truncate font-mono text-[11px]"
							style={snapshot.branch ? undefined : "display: none"}
							data-show="Boolean($_workspaceReviewBranch)"
							data-text="$_workspaceReviewBranch"
							safe
						>
							{snapshot.branch ?? ""}
						</span>
						<div class="pi-review-controls ml-auto flex shrink-0 items-center gap-1">
							<ShortcutKbd shortcut="alt E" />
							<div
								class="flex rounded-md bg-(--pi-control-well) p-0.5"
								aria-label="Diff scope"
							>
								<button
									id="review-mode-all"
									type="button"
									class="rounded-sm px-2 py-1 text-xs font-medium text-muted-foreground aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm"
									aria-pressed="true"
								>
									All
								</button>
								<button
									id="review-mode-selected"
									type="button"
									class="rounded-sm px-2 py-1 text-xs font-medium text-muted-foreground aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm"
									aria-pressed="false"
								>
									Selected
								</button>
							</div>
							<div
								class="flex rounded-md bg-(--pi-control-well) p-0.5"
								aria-label="Diff layout"
							>
								<button
									id="review-layout-split"
									type="button"
									class="rounded-sm p-1 text-xs font-medium text-muted-foreground aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm"
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
									class="rounded-sm p-1 text-xs font-medium text-muted-foreground aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm"
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
							<div class="flex rounded-md bg-(--pi-control-well) p-0.5">
								<button
									id="review-wrap"
									type="button"
									class="rounded-sm p-1 text-xs font-medium text-muted-foreground aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm"
									aria-pressed="true"
									aria-label="Wrap long lines"
									data-tooltip="Wrap long lines"
									data-side="bottom"
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
										<path d="m16 16-3 3 3 3" />
										<path d="M3 12h14.5a1 1 0 0 1 0 7H13M3 19h6M3 5h18" />
									</svg>
								</button>
							</div>
							<span
								id="review-comment-status"
								class="pi-error-foreground hidden text-xs"
								aria-live="polite"
							/>
							<button
								id="review-submit-comments"
								type="button"
								class="btn hidden"
								data-size="xs"
							>
								Submit review
							</button>
							<button
								type="button"
								class="btn text-muted-foreground hover:text-foreground"
								data-variant="ghost"
								data-size="icon-xs"
								data-on:click="$_workspaceReviewOpen = false"
								aria-label="Hide workspace"
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
							class="absolute inset-0 overflow-x-clip overflow-y-auto overscroll-contain outline-none"
							aria-label="Code changes"
							aria-keyshortcuts="Alt+E"
							tabindex="-1"
						/>
						<div
							id="review-empty"
							class="pointer-events-none absolute inset-0 grid place-items-center px-6 text-center text-sm text-muted-foreground"
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
				aria-valuemin={gitPaneRatioMin * 100}
				aria-valuemax={gitPaneRatioMax * 100}
				data-attr:aria-valuenow={`Math.round(($workspaceReviewPreferences.gitPaneRatio ?? ${gitPaneRatioDefault}) * 100)`}
				attrs={resizeHandleAttributes({
					axis: "horizontal",
					defaultValue: gitPaneRatioDefault,
					maximum: gitPaneRatioMax,
					minimum: gitPaneRatioMin,
					preference: "gitPaneRatio",
					scale: "Math.max(1, document.getElementById('workspace-shell').clientWidth - 12)",
				})}
			/>
			{renderWorkspaceReviewData(
				workspacePath,
				filesRevision,
				snapshot,
				preferences,
			)}
			<dialog
				id="workspace-entry-dialog"
				class="dialog"
				aria-labelledby="workspace-entry-title"
				aria-describedby="workspace-entry-description"
			>
				<div class="sm:max-w-sm">
					<header>
						<h2 id="workspace-entry-title">Name item</h2>
						<p id="workspace-entry-description" />
					</header>
					<section>
						<label class="sr-only" for="workspace-entry-input">
							Name
						</label>
						<input
							id="workspace-entry-input"
							class="input"
							type="text"
							autocomplete="off"
							autocorrect="off"
							spellcheck="false"
						/>
						<p
							id="workspace-entry-error"
							class="mt-2 hidden text-sm text-destructive"
							aria-live="polite"
						/>
					</section>
					<footer>
						<button
							id="workspace-entry-cancel"
							type="button"
							class="btn"
							data-variant="outline"
						>
							Cancel
						</button>
						<button id="workspace-entry-action" type="button" class="btn">
							Save
						</button>
					</footer>
				</div>
			</dialog>
			<dialog
				id="workspace-confirm-dialog"
				class="alert-dialog"
				data-size="sm"
				aria-labelledby="workspace-confirm-title"
				aria-describedby="workspace-confirm-description"
			>
				<div>
					<header>
						<h2 id="workspace-confirm-title">Confirm action</h2>
						<p id="workspace-confirm-description" />
					</header>
					<footer>
						<button
							id="workspace-confirm-cancel"
							type="button"
							class="btn"
							data-variant="outline"
						>
							Cancel
						</button>
						<button
							id="workspace-confirm-action"
							type="button"
							class="btn"
							data-variant="destructive"
						>
							Continue
						</button>
					</footer>
				</div>
			</dialog>
		</section>,
	);
}

function renderWorkspaceModeHeader(
	active: "files" | "git",
	gitAvailable: boolean,
): JSX.Element {
	return (
		<header
			class="mb-(--pi-workspace-gap) flex shrink-0"
			style={gitAvailable ? undefined : "display: none"}
			data-show="$_workspaceReviewGitAvailable"
		>
			<div
				class="flex w-full rounded-sm bg-(--pi-control-well) p-0.5"
				aria-label="Workspace view"
			>
				<button
					type="button"
					class="flex flex-1 items-center justify-center gap-2 rounded-[4px] px-2 py-1 text-xs font-medium text-muted-foreground aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm"
					aria-pressed={active === "files" ? "true" : "false"}
					data-attr:aria-pressed="
						$workspaceReviewPreferences.tab === 'files' ||
						!$_workspaceReviewGitAvailable ? 'true' : 'false'
					"
					data-workspace-mode="files"
					aria-keyshortcuts="Alt+F"
				>
					<span>Files</span>
					<ShortcutKbd shortcut="alt F" />
				</button>
				<button
					type="button"
					class="flex flex-1 items-center justify-center gap-2 rounded-[4px] px-2 py-1 text-xs font-medium text-muted-foreground aria-pressed:bg-background aria-pressed:text-foreground aria-pressed:shadow-sm"
					aria-pressed={active === "git" ? "true" : "false"}
					data-attr:aria-pressed="
						$workspaceReviewPreferences.tab !== 'files' &&
						$_workspaceReviewGitAvailable ? 'true' : 'false'
					"
					data-workspace-mode="git"
					disabled={!gitAvailable}
					data-attr:disabled="!$_workspaceReviewGitAvailable"
					aria-keyshortcuts="Alt+G"
				>
					<span>Git</span>
					<ShortcutKbd shortcut="alt G" />
				</button>
			</div>
		</header>
	);
}

export function renderWorkspaceReviewData(
	workspacePath: string,
	filesRevision: number,
	snapshot: WorkspaceReviewSnapshot,
	preferences: WorkspaceReviewPreferences,
): string {
	return syncHtml(
		<script id="workspace-review-data" type="application/json">
			{JSON.stringify({
				filesRevision,
				preferences,
				snapshot,
				workspacePath,
			}).replaceAll("<", "\\u003c")}
		</script>,
	);
}
