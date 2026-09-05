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
import { Icon } from "./icon.tsx";
import { SquareSplitHorizontal, SquareSplitVertical, TextWrap, X } from "./icons.ts";
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
		Math.max(${options.minimum}, ${value} || ${options.defaultValue}),
	);`;
	const commit = `document.body.dispatchEvent(new CustomEvent(
		'pi-ui-workspace-review-preferences',
		{ detail: { ${options.preference}: ${value} } },
	));`;
	const finish = `if (el.hasPointerCapture(evt.pointerId)) {
		${normalize}
		document.documentElement.classList.remove('is-resizing');
		${commit}
	}`;
	return {
		"data-on:pointerdown": `if (evt.button === 0) {
			el.dataset.resizePointer = evt.${coordinate};
			el.dataset.resizeScale = ${options.scale};
			el.dataset.resizeStart = ${value} || ${options.defaultValue};
			el.setPointerCapture(evt.pointerId);
			document.documentElement.classList.add('is-resizing');
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
			${value} = (${value} || ${options.defaultValue}) +
				direction * (evt.shiftKey ? 48 : 16) / (${options.scale});
			${normalize}
			${commit}
		}`,
	};
}

export function renderWorkspaceReview(
	workspacePath: string,
	filesRevision: number,
	treeRevision: number,
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
			<div
				id="review-body"
				class="review-body"
				data-style={`{
					'--review-sidebar-width': ($workspaceReviewPreferences.reviewSidebarWidth || ${reviewSidebarWidthDefault}) + 'px',
				}`}
			>
				<aside
					id="workspace-files-sidebar"
					class="review-sidebar"
					style={
						snapshot.isGitRepository && preferences.tab !== "files"
							? "display: none"
							: undefined
					}
					data-show="!$_workspaceReviewGitAvailable || $workspaceReviewPreferences.tab === 'files'"
				>
					{renderWorkspaceModeHeader("files", snapshot.isGitRepository)}
					<section class="raised-surface review-sidebar-panel">
						<div
							id="workspace-file-tree"
							class="review-tree"
							aria-label="Workspace files"
							tabindex="-1"
						/>
					</section>
				</aside>

				<aside
					id="review-git-sidebar"
					class="review-sidebar"
					data-style={`{
						'--review-changes-ratio': $workspaceReviewPreferences.changesRatio || ${changesRatioDefault},
					}`}
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
						class="raised-surface review-sidebar-panel review-changes"
						hidden={snapshot.changes.length === 0}
						data-attr:hidden="$_workspaceReviewChangeCount === 0"
					>
						<header class="review-sidebar-header">
							<span>Changes</span>
							<span
								id="review-change-count"
								class="fine-print review-change-count"
								data-text="$_workspaceReviewChangeCount"
							>
								{snapshot.changes.length}
							</span>
							<span class="review-change-totals">
								<span
									id="review-total-additions"
									class="review-additions"
									data-text="'+' + $_workspaceReviewAdditions"
								>
									+{additions}
								</span>
								<span
									id="review-total-deletions"
									class="review-deletions"
									data-text="'-' + $_workspaceReviewDeletions"
								>
									-{deletions}
								</span>
							</span>
						</header>
						<div
							id="review-tree"
							class="review-tree"
							style={workspaceTreeStyle}
							aria-label="Git changes"
							tabindex="-1"
							data-show="$_workspaceReviewChangeCount > 0"
						/>
						<div
							id="review-tree-empty"
							class="review-tree-empty"
							style={
								snapshot.changes.length > 0 ? "display: none" : undefined
							}
							data-show="$_workspaceReviewChangeCount === 0"
						>
							Working tree clean
						</div>
					</section>
					<div
						id="review-changes-separator"
						class="resize-handle"
						data-orientation="horizontal"
						role="separator"
						tabindex="0"
						hidden={snapshot.changes.length === 0}
						data-attr:hidden="$_workspaceReviewChangeCount === 0"
						aria-label="Resize Changes and History"
						aria-orientation="horizontal"
						aria-valuemin={changesRatioMin * 100}
						aria-valuemax={changesRatioMax * 100}
						data-attr:aria-valuenow={`Math.round(($workspaceReviewPreferences.changesRatio || ${changesRatioDefault}) * 100)`}
						attrs={resizeHandleAttributes({
							axis: "vertical",
							defaultValue: changesRatioDefault,
							maximum: changesRatioMax,
							minimum: changesRatioMin,
							preference: "changesRatio",
							scale: "Math.max(1, el.parentElement.clientHeight - el.parentElement.firstElementChild.offsetHeight - el.offsetHeight)",
						})}
					/>
					<section class="raised-surface review-sidebar-panel">
						<header class="review-sidebar-header">History</header>
						<div
							id="review-history"
							class="review-history"
							aria-label="Commit history"
							tabindex="-1"
						>
							<p class="review-loading">Loading history…</p>
						</div>
					</section>
				</aside>

				<div
					id="review-sidebar-separator"
					class="resize-handle"
					role="separator"
					tabindex="0"
					aria-label="Resize file sidebar"
					aria-orientation="vertical"
					aria-valuemin={reviewSidebarWidthMin}
					aria-valuemax={reviewSidebarWidthMax}
					data-attr:aria-valuenow={`$workspaceReviewPreferences.reviewSidebarWidth || ${reviewSidebarWidthDefault}`}
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
					class="review-main"
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
					<header class="review-toolbar">
						<div class="review-file-heading">
							<span
								id="workspace-file-path"
								class="fine-print review-file-path"
							>
								Select a file
							</span>
							<span
								id="workspace-file-status"
								class="fine-print review-file-status"
							/>
						</div>
						<div class="review-toolbar-controls">
							<ShortcutKbd shortcut="alt E" />
							<div class="segmented-control review-icon-control">
								<button
									id="workspace-file-wrap"
									type="button"
									class="review-segment-icon"
									aria-pressed="true"
									aria-label="Wrap long lines"
								>
									<Icon icon={TextWrap} />
								</button>
							</div>
							<button
								id="workspace-file-download"
								type="button"
								class="btn"
								data-variant="outline"
								data-size="xs"
								title="Download the saved file"
								disabled
							>
								Download
							</button>
							<button
								id="workspace-file-edit"
								type="button"
								class="btn"
								data-variant="outline"
								data-size="xs"
								disabled
							>
								Save
							</button>
							<button
								type="button"
								class="btn review-close"
								data-variant="ghost"
								data-size="icon-xs"
								data-on:click="$_workspaceReviewOpen = false"
								aria-label="Hide workspace"
							>
								<Icon icon={X} />
							</button>
						</div>
					</header>
					<div class="review-diff-canvas">
						<div
							id="workspace-file-view"
							class="review-scroll-view"
							aria-label="File contents"
							aria-keyshortcuts="Alt+E"
							tabindex="-1"
						/>
						<div id="workspace-file-empty" class="review-empty">
							Open a file from the workspace
						</div>
					</div>
				</div>

				<div
					id="review-git-main"
					class="review-main"
					style={
						!snapshot.isGitRepository || preferences.tab === "files"
							? "display: none"
							: undefined
					}
					data-show="$_workspaceReviewGitAvailable && $workspaceReviewPreferences.tab !== 'files'"
				>
					<header class="review-toolbar">
						<span
							id="review-branch"
							class="fine-print review-branch"
							hidden={!snapshot.branch}
							data-attr:hidden="!Boolean($_workspaceReviewBranch)"
							data-text="$_workspaceReviewBranch"
							safe
						>
							{snapshot.branch ?? ""}
						</span>
						<div class="review-toolbar-controls">
							<ShortcutKbd shortcut="alt E" />
							<div class="segmented-control" aria-label="Diff scope">
								<button
									id="review-mode-all"
									type="button"
									class="review-segment-text"
									aria-pressed="true"
								>
									All
								</button>
								<button
									id="review-mode-selected"
									type="button"
									class="review-segment-text"
									aria-pressed="false"
								>
									Selected
								</button>
							</div>
							<div
								class="segmented-control review-icon-control"
								aria-label="Diff layout"
							>
								<button
									id="review-layout-split"
									type="button"
									class="review-segment-icon"
									aria-pressed="true"
									aria-label="Split diff layout"
								>
									<Icon icon={SquareSplitHorizontal} />
								</button>
								<button
									id="review-layout-stacked"
									type="button"
									class="review-segment-icon"
									aria-pressed="false"
									aria-label="Stacked diff layout"
								>
									<Icon icon={SquareSplitVertical} />
								</button>
							</div>
							<div class="segmented-control review-icon-control">
								<button
									id="review-wrap"
									type="button"
									class="review-segment-icon"
									aria-pressed="true"
									aria-label="Wrap long lines"
								>
									<Icon icon={TextWrap} />
								</button>
							</div>
							<span
								id="review-comment-status"
								class="error-foreground review-comment-status"
								hidden
								aria-live="polite"
							/>
							<button
								id="review-submit-comments"
								type="button"
								class="btn review-submit"
								data-size="xs"
								hidden
							>
								Submit review
							</button>
							<button
								type="button"
								class="btn review-close"
								data-variant="ghost"
								data-size="icon-xs"
								data-on:click="$_workspaceReviewOpen = false"
								aria-label="Hide workspace"
							>
								<Icon icon={X} />
							</button>
						</div>
					</header>
					<header id="review-detail-header" hidden />
					<div class="review-diff-canvas">
						<div
							id="review-diff-view"
							class="review-scroll-view review-diff-view"
							aria-label="Code changes"
							aria-keyshortcuts="Alt+E"
							tabindex="-1"
						/>
						<div id="review-empty" class="review-empty">
							{snapshot.isGitRepository
								? "Loading Git data…"
								: "Open a Git repository"}
						</div>
					</div>
				</div>
			</div>
			<div
				id="review-git-separator"
				class="resize-handle"
				role="separator"
				tabindex="0"
				aria-label="Resize Git and chat"
				aria-orientation="vertical"
				aria-valuemin={gitPaneRatioMin * 100}
				aria-valuemax={gitPaneRatioMax * 100}
				data-attr:aria-valuenow={`Math.round(($workspaceReviewPreferences.gitPaneRatio || ${gitPaneRatioDefault}) * 100)`}
				attrs={resizeHandleAttributes({
					axis: "horizontal",
					defaultValue: gitPaneRatioDefault,
					maximum: gitPaneRatioMax,
					minimum: gitPaneRatioMin,
					preference: "gitPaneRatio",
					scale: "Math.max(1, document.getElementById('workspace-shell').clientWidth - 12)",
				})}
			/>
			{renderWorkspaceReviewDataRegion(
				workspacePath,
				filesRevision,
				treeRevision,
				snapshot,
				preferences,
			)}
			<dialog
				id="workspace-entry-dialog"
				class="dialog"
				aria-labelledby="workspace-entry-title"
				aria-describedby="workspace-entry-description"
			>
				<div class="dialog-medium">
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
							class="workspace-entry-error"
							hidden
							aria-live="polite"
						/>
					</section>
					<footer>
						<button
							type="button"
							class="btn"
							data-variant="outline"
							commandfor="workspace-entry-dialog"
							command="close"
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
					<form method="dialog">
						<button
							id="workspace-confirm-cancel"
							type="submit"
							class="btn"
							data-variant="outline"
							value="cancel"
						>
							Cancel
						</button>
						<button
							id="workspace-confirm-action"
							type="submit"
							class="btn"
							data-variant="destructive"
							value="confirm"
						>
							Continue
						</button>
					</form>
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
			class="workspace-mode-header"
			style={gitAvailable ? undefined : "display: none"}
			data-show="$_workspaceReviewGitAvailable"
		>
			<div
				class="segmented-control workspace-mode-control"
				aria-label="Workspace view"
			>
				<button
					type="button"
					class="workspace-mode-button"
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
					class="workspace-mode-button"
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

function workspaceReviewDataElement(
	workspacePath: string,
	filesRevision: number,
	treeRevision: number,
	snapshot: WorkspaceReviewSnapshot,
	preferences: WorkspaceReviewPreferences,
): JSX.Element {
	return (
		<script id="workspace-review-data" type="application/json">
			{JSON.stringify({
				filesRevision,
				treeRevision,
				preferences,
				snapshot,
				workspacePath,
			}).replaceAll("<", "\\u003c")}
		</script>
	);
}

function renderWorkspaceReviewDataRegion(
	workspacePath: string,
	filesRevision: number,
	treeRevision: number,
	snapshot: WorkspaceReviewSnapshot,
	preferences: WorkspaceReviewPreferences,
): JSX.Element {
	return (
		<div id="workspace-review-data-region" hidden>
			{workspaceReviewDataElement(
				workspacePath,
				filesRevision,
				treeRevision,
				snapshot,
				preferences,
			)}
		</div>
	);
}

export function renderWorkspaceReviewData(
	workspacePath: string,
	filesRevision: number,
	treeRevision: number,
	snapshot: WorkspaceReviewSnapshot,
	preferences: WorkspaceReviewPreferences,
): string {
	return syncHtml(
		workspaceReviewDataElement(
			workspacePath,
			filesRevision,
			treeRevision,
			snapshot,
			preferences,
		),
	);
}
