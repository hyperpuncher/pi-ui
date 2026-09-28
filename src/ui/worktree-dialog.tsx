import type { GitBranch, GitWorktreeContext } from "../server/git-worktrees.ts";
import { defaultWorktreeBase } from "../server/git-worktrees.ts";
import { endpoints } from "../server/routes/endpoints.ts";
import { Icon } from "./icon.tsx";
import { syncHtml } from "./sync-html.ts";

export function renderWorktreeDialog(): string {
	return syncHtml(
		<dialog
			id="worktree-dialog"
			class="dialog"
			aria-labelledby="worktree-dialog-title"
			data-preserve-attr="open"
			closedby="any"
		>
			<div id="worktree-dialog-content" class="worktree-dialog-loading">
				<h2 id="worktree-dialog-title" class="sr-only">
					Branches and worktrees
				</h2>
				Loading worktrees…
			</div>
		</dialog>,
	);
}

/** Local branches that are not checked out in any worktree, this one included. */
export function worktreeSwitchableBranches(branches: readonly GitBranch[]): GitBranch[] {
	return branches.filter(
		(branch) => branch.ref.startsWith("refs/heads/") && !branch.worktreePath,
	);
}

export function renderWorktreeDialogContent(
	context: GitWorktreeContext | undefined,
): string {
	if (!context) {
		return syncHtml(
			<div id="worktree-dialog-content">
				<h2 id="worktree-dialog-title" class="sr-only">
					Branches and worktrees
				</h2>
				<p class="dialog-empty">
					The current workspace is not inside a Git repository.
				</p>
			</div>,
		);
	}
	const otherWorktrees = context.worktrees.filter((worktree) => !worktree.current);
	const switchableBranches = worktreeSwitchableBranches(context.branches);
	const base = defaultWorktreeBase(context);
	const branches = [...context.branches];
	if (base === "HEAD") {
		branches.push({
			ref: "HEAD",
			label: context.currentBranch ? "HEAD (unborn)" : "HEAD (detached)",
		});
	}
	const branchLabels = Object.fromEntries(
		branches.map((branch) => [branch.ref, branch.label]),
	);
	const branchLabelExpression = `${JSON.stringify(branchLabels)}[$_worktreeBase] ?? 'HEAD'`;
	return syncHtml(
		<div id="worktree-dialog-content">
			<h2 id="worktree-dialog-title" class="sr-only">
				Branches and worktrees
			</h2>
			<div
				class="segmented-control worktree-tabs"
				role="group"
				aria-label="Branches and worktrees"
			>
				<button
					type="button"
					aria-pressed="true"
					data-attr:aria-pressed={`$_worktreeTab === 'branches' ? 'true' : 'false'`}
					data-on:click="$_worktreeTab = 'branches'"
				>
					Branches
				</button>
				<button
					type="button"
					aria-pressed="false"
					data-attr:aria-pressed={`$_worktreeTab === 'worktrees' ? 'true' : 'false'`}
					data-on:click="$_worktreeTab = 'worktrees'"
				>
					Worktrees
				</button>
			</div>
			<div class="dialog-flow-compact" data-show="$_worktreeTab === 'branches'">
				{switchableBranches.length > 0 && (
					<>
						<div class="worktree-list">
							{switchableBranches.map((branch) => (
								<div class="worktree-row">
									<button
										type="button"
										class="worktree-row-main"
										data-attr:disabled="$_worktreeCreating"
										data-on:click={`@post('${endpoints.branchSwitch}', {
										payload: { branch: ${JSON.stringify(branch.label)} },
										retry: 'never',
										});`}
									>
										<Icon name="git-branch" />
										<span class="worktree-row-title" safe>
											{branch.label}
										</span>
									</button>
									<button
										type="button"
										class="btn row-action row-action-danger"
										data-variant="ghost"
										data-size="icon-xs"
										aria-label={`Delete ${branch.label}`}
										commandfor="branch-delete-dialog"
										command="show-modal"
										data-attr:disabled="$_worktreeCreating"
										data-on:click={`$_branchDeleteName = ${JSON.stringify(branch.label)};`}
									>
										<Icon name="trash" />
									</button>
								</div>
							))}
						</div>
						<hr class="worktree-divider" />
					</>
				)}
				<form
					class="dialog-flow-compact worktree-create-fields"
					data-indicator:_worktree-creating
					data-on:submit={`if (el.reportValidity()) {
						$_worktreeError = '';
						@post('${endpoints.branchCreate}', {
							payload: { branch: $_branchName },
							retry: 'never',
						});
					}`}
				>
					<label>
						<span>New branch</span>
						<input
							class="input"
							type="text"
							required
							autocomplete="off"
							autocapitalize="off"
							spellcheck="false"
							placeholder="feature/my-branch"
							data-bind:_branch-name
							aria-describedby="worktree-dialog-error"
							data-attr:aria-invalid="Boolean($_worktreeError)"
							data-on:input="$_worktreeError = ''"
						/>
					</label>
					<button
						type="submit"
						class="btn"
						data-attr:disabled="$_worktreeCreating"
					>
						Create branch
					</button>
				</form>
			</div>
			<div
				class="dialog-flow-compact"
				style="display: none"
				data-show="$_worktreeTab === 'worktrees'"
			>
				{otherWorktrees.length > 0 && (
					<>
						<div class="worktree-list">
							{otherWorktrees.map((worktree) => {
								const label =
									worktree.branch ??
									`detached at ${worktree.head.slice(0, 8)}`;
								return (
									<div class="worktree-row">
										<button
											type="button"
											class="worktree-row-main"
											title={worktree.path}
											commandfor="worktree-dialog"
											command="close"
											data-attr:disabled={
												worktree.missing
													? "true"
													: "$_worktreeCreating"
											}
											data-on:click={`@post('${endpoints.workspaceOpen}', {
											payload: { workspacePath: ${JSON.stringify(worktree.sessionPath)} },
											});`}
										>
											<Icon name="folder" />
											<span class="worktree-row-text">
												<span class="worktree-row-title" safe>
													{label}
												</span>
												{worktree.missing && (
													<span class="worktree-row-description">
														Missing checkout
													</span>
												)}
											</span>
										</button>
										{worktree.path !== context.projectRoot && (
											<button
												type="button"
												class="btn row-action row-action-danger"
												data-variant="ghost"
												data-size="icon-xs"
												aria-label={`Remove ${label}`}
												commandfor="worktree-remove-dialog"
												command="show-modal"
												data-attr:disabled="$_worktreeCreating"
												data-on:click={`
													$_worktreeRemovePath = ${JSON.stringify(worktree.path)};
													$_worktreeRemoveLabel = ${JSON.stringify(label)};
													$_worktreeRemoveReady = false;
													$_worktreeRemoveRevision = '';
													$_worktreeRemoveError = '';
													@get('${endpoints.worktreeRemove}', {
														payload: { path: $_worktreeRemovePath },
														retry: 'never',
													});
												`}
											>
												<Icon name="trash" />
											</button>
										)}
									</div>
								);
							})}
						</div>
						<hr class="worktree-divider" />
					</>
				)}
				<form
					class="dialog-flow-compact worktree-create-fields"
					data-indicator:_worktree-creating
					data-on:submit={`if (el.reportValidity()) {
						$_worktreeError = '';
						@post('${endpoints.worktreeCreate}', {
							payload: { branch: $_worktreeBranch, base: $_worktreeBase },
							retry: 'never',
						});
					}`}
				>
					<div class="worktree-base-field">
						<span id="worktree-base-label">Base branch</span>
						<div class="dropdown-menu worktree-base-select">
							<button
								type="button"
								class="input worktree-base-trigger"
								aria-haspopup="menu"
								aria-controls="worktree-base-popover"
								aria-labelledby="worktree-base-label worktree-base-value"
								popovertarget="worktree-base-popover"
							>
								<span
									id="worktree-base-value"
									class="worktree-base-value"
									data-text={branchLabelExpression}
									safe
								>
									{branchLabels[base]}
								</span>
								<Icon name="chevron-down" />
							</button>
							<div
								id="worktree-base-popover"
								class="worktree-base-popover"
								popover="auto"
								data-popover
								data-side="bottom"
								data-align="start"
								role="menu"
								aria-labelledby="worktree-base-label"
							>
								{branches.map((branch) => (
									<button
										type="button"
										role="menuitemradio"
										tabindex="-1"
										autofocus={branch.ref === base}
										aria-checked={
											branch.ref === base ? "true" : "false"
										}
										data-attr:aria-checked={`$_worktreeBase === ${JSON.stringify(branch.ref)}`}
										commandfor="worktree-base-popover"
										command="hide-popover"
										data-on:click={`$_worktreeBase = ${JSON.stringify(branch.ref)}`}
									>
										<span safe>{branch.label}</span>
										<span
											data-ignore
											data-indicator
											aria-hidden="true"
										>
											<span class="selection-dot" />
										</span>
									</button>
								))}
							</div>
						</div>
					</div>
					<label>
						<span>New branch</span>
						<input
							class="input"
							type="text"
							required
							autocomplete="off"
							autocapitalize="off"
							spellcheck="false"
							placeholder="feature/my-branch"
							data-bind:_worktree-branch
							aria-describedby="worktree-dialog-error"
							data-attr:aria-invalid="Boolean($_worktreeError)"
							data-on:input="$_worktreeError = ''"
						/>
					</label>
					<button
						type="submit"
						class="btn"
						data-attr:disabled="$_worktreeCreating"
					>
						Create worktree
					</button>
				</form>
			</div>
			<p
				id="worktree-dialog-error"
				class="worktree-error"
				role="alert"
				data-show="$_worktreeError"
				data-text="$_worktreeError"
			/>
		</div>,
	);
}

export function renderBranchDeleteDialog(): string {
	return syncHtml(
		<dialog
			id="branch-delete-dialog"
			class="dialog"
			aria-labelledby="branch-delete-title"
			data-signals__ifmissing="{ _branchDeleteName: '' }"
			closedby="any"
		>
			<div class="dialog-medium">
				<header>
					<h2 id="branch-delete-title">Delete branch?</h2>
					<p>
						<strong class="dialog-emphasis" data-text="$_branchDeleteName">
							the selected branch
						</strong>{" "}
						will be deleted. Unmerged commits are discarded.
					</p>
				</header>
				<footer>
					<button
						type="button"
						class="btn"
						data-variant="outline"
						commandfor="branch-delete-dialog"
						command="close"
					>
						Cancel
					</button>
					<button
						type="button"
						class="btn"
						data-variant="destructive"
						commandfor="branch-delete-dialog"
						command="close"
						data-attr:disabled="$_branchDeleteName === ''"
						data-on:click={`@post('${endpoints.branchDelete}', {
							payload: { branch: $_branchDeleteName },
						})`}
					>
						Delete branch
					</button>
				</footer>
			</div>
		</dialog>,
	);
}

export function renderWorktreeIgnoredPaths(paths: readonly string[]): string {
	return syncHtml(
		<div
			id="worktree-remove-ignored"
			data-show="$_worktreeRemoveReady"
			style="display: none"
		>
			{paths.length > 0 && (
				<>
					<p class="dialog-description">These ignored paths will be deleted:</p>
					<ul class="worktree-ignored-list">
						{paths.map((path) => (
							<li safe>{path}</li>
						))}
					</ul>
				</>
			)}
		</div>,
	);
}

export function renderWorktreeRemoveDialog(): string {
	return syncHtml(
		<dialog
			id="worktree-remove-dialog"
			class="dialog"
			aria-labelledby="worktree-remove-title"
			data-signals__ifmissing="{
				_worktreeRemovePath: '',
				_worktreeRemoveLabel: '',
				_worktreeRemoveReady: false,
				_worktreeRemoveCount: 0,
				_worktreeRemoveRevision: '',
				_worktreeRemoveError: '',
			}"
			closedby="any"
		>
			<div class="dialog-medium">
				<header>
					<h2 id="worktree-remove-title">Remove checkout?</h2>
					<p>
						<strong class="dialog-emphasis" data-text="$_worktreeRemoveLabel">
							the selected checkout
						</strong>{" "}
						will be removed. Modified and untracked files block removal. Its
						sessions and any branch will remain.
					</p>
					<p
						class="dialog-description"
						data-show="!$_worktreeRemoveReady && !$_worktreeRemoveError"
					>
						Checking ignored files…
					</p>
					<div
						id="worktree-remove-ignored"
						style="display: none"
						data-show="$_worktreeRemoveReady"
					/>
					<p
						class="worktree-error"
						role="alert"
						data-show="$_worktreeRemoveError"
						data-text="$_worktreeRemoveError"
					/>
				</header>
				<footer>
					<button
						type="button"
						class="btn"
						data-variant="outline"
						commandfor="worktree-remove-dialog"
						command="close"
					>
						Cancel
					</button>
					<button
						type="button"
						class="btn"
						data-variant="destructive"
						data-indicator:_worktree-removing
						data-attr:disabled="
							!$_worktreeRemoveReady ||
							$_worktreeRemoving
						"
						data-on:click={`@post('${endpoints.worktreeRemove}', {
							payload: { path: $_worktreeRemovePath, revision: $_worktreeRemoveRevision },
							retry: 'never',
						})`}
						data-text="$_worktreeRemoveCount > 0 ? 'Remove checkout and ignored files' : 'Remove checkout'"
					>
						Remove checkout
					</button>
				</footer>
			</div>
		</dialog>,
	);
}
