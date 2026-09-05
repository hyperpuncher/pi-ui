import type { AutocompleteItem } from "@earendil-works/pi-tui";

import { endpoints } from "../server/routes/endpoints.ts";
import type {
	WorkspaceDirectoryListing,
	WorkspaceSuggestion,
} from "../server/workspace-search.ts";
import type { AppSessionSummary, AppSlashCommand } from "../state/app-store.ts";
import type { AppStateSnapshot } from "../state/app-store.ts";
import { formatMessageCount } from "../utils/format.ts";
import { formatHomePath, workspaceDisplayName } from "../utils/workspace.ts";
import { DateTime } from "./date-time.tsx";
import { Icon } from "./icon.tsx";
import { Folder, Square } from "./icons.ts";
import {
	PickerEmpty,
	PickerList,
	PickerMetadata,
	PickerRow,
} from "./picker-components.tsx";
import { SessionRenameTitle } from "./session-rename.tsx";
import { SessionRowAction } from "./session-row-action.tsx";
import { renderSessionPageTrigger } from "./session-sidebar.tsx";
import { sessionStatusLabel } from "./session-status.ts";
import { SessionSubtitle } from "./session-summary.tsx";
import { resumeSessionAction } from "./session-transition.tsx";
import { StatusDot } from "./status-dot.tsx";
import { syncHtml } from "./sync-html.ts";

const bottomAnchoredPickerClass = "picker-list picker-list-bottom";

export function slashPickerOpenExpression(state: AppStateSnapshot): string {
	const names = state.slashCommands.map(slashCommandName);
	return `$prompt.startsWith('/') &&
		!$prompt.includes(' ') &&
		${JSON.stringify(names)}.some((name) =>
			window.piUi.pickers.fuzzyMatch($prompt.slice(1), name).matches
		)`;
}

export function renderSlashPicker(state: AppStateSnapshot): string {
	return syncHtml(
		<div id="slash-picker">
			<PickerList id="slash-picker-list" class={bottomAnchoredPickerClass}>
				{state.slashCommands.length === 0 ? (
					<PickerEmpty>No prompts or skills found.</PickerEmpty>
				) : (
					state.slashCommands.map((item, index) => renderSlashRow(item, index))
				)}
			</PickerList>
		</div>,
	);
}

function slashCommandName(item: AppSlashCommand): string {
	return item.name.toLowerCase();
}

function renderSlashRow(item: AppSlashCommand, index: number): string {
	const label = `/${item.name}`;
	const name = slashCommandName(item);
	return syncHtml(
		<li
			id={`slash-option-${encodeURIComponent(name)}`}
			role="option"
			tabindex="-1"
			class="picker-row"
			aria-selected={index === 0 ? "true" : "false"}
			data-preserve-attr="aria-selected"
			data-slash-row
			data-slash-name={name}
			data-slash-order={index}
			data-show={`
				$_slashPickerOpen &&
				window.piUi.pickers.fuzzyMatch($prompt.slice(1), ${JSON.stringify(name)}).matches
			`}
		>
			<button
				class="picker-row-button"
				type="button"
				data-picker-kind="slash"
				data-on:click={`
					window.piUi.messageScroll.scrollBottom();
					$prompt = '';
					@post('${endpoints.prompt}', { payload: { prompt: ${JSON.stringify(label)} } });
				`}
			>
				<span class="picker-row-content">
					<span class="slash-command-title">
						<span class="slash-command-name" safe>
							{label}
						</span>
						{item.argumentHint && (
							<span class="slash-command-argument" safe>
								{item.argumentHint}
							</span>
						)}
					</span>
					<span class="picker-row-description" safe>
						{item.description || item.source}
					</span>
				</span>
				<PickerMetadata text={item.source} />
			</button>
		</li>,
	);
}

export function renderWorkspaceDialogMenu(state: AppStateSnapshot): string {
	const workspaces = uniqueWorkspaces([state.workspacePath, ...state.recentWorkspaces]);
	return syncHtml(
		<div
			role="menu"
			id="workspace-menu"
			class="command-menu"
			aria-orientation="vertical"
		>
			{renderWorkspaceSearchResults(workspaces, [], state.workspacePath)}
		</div>,
	);
}

export function renderFilePickerResults(
	items: readonly AutocompleteItem[],
	query = "",
): string {
	return syncHtml(
		<div
			id="file-picker-results"
			aria-live="polite"
			data-init={`window.piUi.pickers.resetFile(${JSON.stringify(query)})`}
		>
			<PickerList id="file-picker-list" class={bottomAnchoredPickerClass}>
				{items.map((item, index) => (
					<PickerRow
						kind="file"
						value={item.value}
						label={item.label}
						description={item.description ?? ""}
						metadata={item.label.endsWith("/") ? "dir" : "file"}
						selected={index === 0}
					/>
				))}
			</PickerList>
		</div>,
	);
}

export function renderWorkspaceBrowserContent(
	listing: WorkspaceDirectoryListing,
): string {
	return syncHtml(
		<div id="workspace-browser-content" class="workspace-browser-panel">
			<header class="workspace-browser-header">
				<div class="workspace-browser-heading">
					<h2 id="workspace-browser-title">
						<span data-show="$_workspaceAction !== 'fork'">
							Select folder
						</span>
						<span data-show="$_workspaceAction === 'fork'">
							Fork session to folder
						</span>
					</h2>
					<button
						type="button"
						class="btn"
						data-variant={listing.showHidden ? "secondary" : "ghost"}
						data-size="xs"
						data-attr:data-variant="$_workspaceBrowserShowHidden ? 'secondary' : 'ghost'"
						aria-label={
							listing.showHidden
								? "Hide hidden folders"
								: "Show hidden folders"
						}
						aria-pressed={listing.showHidden ? "true" : "false"}
						data-attr:aria-label="$_workspaceBrowserShowHidden ? 'Hide hidden folders' : 'Show hidden folders'"
						data-attr:aria-pressed="$_workspaceBrowserShowHidden ? 'true' : 'false'"
						data-on:click={`
							$_workspaceBrowserShowHidden = !$_workspaceBrowserShowHidden;
							${browseWorkspaceAction(JSON.stringify(listing.path))};
						`}
					>
						<span data-show="!$_workspaceBrowserShowHidden">Show hidden</span>
						<span data-show="$_workspaceBrowserShowHidden">Hide hidden</span>
					</button>
				</div>
				<p class="workspace-browser-path" title={listing.path} safe>
					{formatHomePath(listing.path)}
				</p>
			</header>
			<div class="workspace-browser-list">
				{listing.parent && renderWorkspaceBrowserDirectory(listing.parent, "..")}
				{listing.directories.map((directory) =>
					renderWorkspaceBrowserDirectory(
						directory,
						workspaceDisplayName(directory),
					),
				)}
				{listing.directories.length === 0 && (
					<p class="workspace-browser-empty">No folders found.</p>
				)}
			</div>
			<footer class="workspace-browser-footer">
				<button
					type="button"
					class="btn"
					data-variant="outline"
					commandfor="workspace-browser-dialog"
					command="close"
				>
					Cancel
				</button>
				<button
					type="button"
					class="btn"
					data-attr:disabled="$_sessionTransitionLoading"
					data-on:click={openWorkspaceFromBrowserAction(
						JSON.stringify(listing.path),
					)}
				>
					<span data-show="$_workspaceAction !== 'fork'">Open folder</span>
					<span data-show="$_workspaceAction === 'fork'">Fork session</span>
				</button>
			</footer>
		</div>,
	);
}

export function renderWorkspaceBrowserError(path: string): string {
	return syncHtml(
		<div
			id="workspace-browser-content"
			class="workspace-browser-panel workspace-browser-error"
		>
			<header class="workspace-browser-header">
				<h2 id="workspace-browser-title">Select folder</h2>
			</header>
			<p class="workspace-browser-error-message">
				Could not read{" "}
				<span class="workspace-browser-error-path" safe>
					{formatHomePath(path)}
				</span>
				.
			</p>
			<footer class="workspace-browser-footer">
				<button
					type="button"
					class="btn"
					commandfor="workspace-browser-dialog"
					command="close"
				>
					Close
				</button>
			</footer>
		</div>,
	);
}

function renderWorkspaceBrowserDirectory(path: string, label: string): string {
	return syncHtml(
		<button
			type="button"
			class="workspace-browser-directory"
			data-indicator:_workspace-browser-loading
			data-attr:disabled="$_workspaceBrowserLoading"
			data-on:click={browseWorkspaceAction(JSON.stringify(path))}
		>
			<Icon icon={Folder} class="workspace-browser-directory-icon" />
			<span class="workspace-browser-directory-name" safe>
				{label}
			</span>
		</button>,
	);
}

export function renderWorkspaceSearchResults(
	recentWorkspaces: readonly string[],
	searchWorkspaces: readonly WorkspaceSuggestion[],
	currentWorkspacePath: string,
): string {
	const recent = uniqueWorkspaces(recentWorkspaces);
	const search = uniqueWorkspaces(
		searchWorkspaces.map((workspace) => workspace.path),
	).filter((workspacePath) => !recent.includes(workspacePath));
	return syncHtml(
		<div id="workspace-search-results">
			{recent.length > 0 &&
				renderWorkspaceGroup("Recent workspaces", recent, currentWorkspacePath)}
			{search.length > 0 &&
				renderWorkspaceGroup("Search results", search, currentWorkspacePath)}
		</div>,
	);
}

function renderWorkspaceGroup(
	heading: string,
	workspaces: readonly string[],
	currentWorkspacePath: string,
): string {
	const id =
		heading === "Recent workspaces"
			? "workspace-recent-heading"
			: "workspace-search-heading";
	return syncHtml(
		<div role="group" aria-labelledby={id}>
			<span role="heading" id={id} class="workspace-group-heading">
				{heading}
			</span>
			{workspaces.map((workspacePath) =>
				renderWorkspaceRow(workspacePath, workspacePath === currentWorkspacePath),
			)}
		</div>,
	);
}

function renderWorkspaceRow(workspacePath: string, current: boolean): string {
	const label = formatHomePath(workspacePath);
	const faviconUrl = `${endpoints.sessionsFavicon}?cwd=${encodeURIComponent(workspacePath)}`;
	return syncHtml(
		<div
			id={`workspace-option-${encodeURIComponent(workspacePath)}`}
			role="menuitem"
			class="workspace-row"
			data-preserve-attr="class"
			tabindex="-1"
			aria-current={current ? "true" : undefined}
			data-filter={`${label} ${workspacePath}`}
			data-keywords={`${label} ${workspacePath}`}
			data-indicator:_session-loading
			data-attr:aria-disabled="$_sessionTransitionLoading ? 'true' : 'false'"
			data-on:click={openWorkspaceAction(JSON.stringify(workspacePath))}
		>
			<img class="workspace-favicon" src={faviconUrl} alt="" aria-hidden="true" />
			<span class="workspace-row-label" safe>
				{label}
			</span>
			{current && <span class="selection-dot" aria-hidden="true" />}
		</div>,
	);
}

function openWorkspaceAction(valueExpression: string): string {
	return `if (!$_sessionTransitionLoading) {
		if ($_workspaceAction === 'fork') {
			@post('${endpoints.sessionsForkToWorkspace}', {
				payload: { workspacePath: ${valueExpression} },
			});
		} else {
			@post('${endpoints.workspaceOpen}', {
				payload: { workspacePath: ${valueExpression} },
			});
		}
	}`;
}

function browseWorkspaceAction(
	valueExpression: string,
	showHiddenExpression = "$_workspaceBrowserShowHidden",
): string {
	return `@get('${endpoints.workspaceBrowse}', {
		payload: {
			workspacePath: ${valueExpression},
			showHidden: ${showHiddenExpression},
		},
		requestCancellation: 'cleanup',
	})`;
}

function openWorkspaceFromBrowserAction(valueExpression: string): string {
	return `if (!$_sessionTransitionLoading) {
		document.getElementById('workspace-browser-dialog')?.close();
		if ($_workspaceAction === 'fork') {
			@post('${endpoints.sessionsForkToWorkspace}', {
				payload: { workspacePath: ${valueExpression} },
			});
		} else {
			@post('${endpoints.workspaceOpen}', {
				payload: { workspacePath: ${valueExpression} },
			});
		}
	}`;
}

function uniqueWorkspaces(workspaces: readonly string[]): string[] {
	const unique: string[] = [];
	for (const workspacePath of workspaces) {
		if (!workspacePath || unique.includes(workspacePath)) {
			continue;
		}
		unique.push(workspacePath);
	}
	return unique;
}

export function renderSessionPicker(state: AppStateSnapshot): string {
	return syncHtml(
		<div
			role="menu"
			id="session-menu"
			class="session-menu"
			aria-orientation="vertical"
			data-empty="No matching sessions."
			data-signals:background-session-path__ifmissing="''"
		>
			{renderSessionPickerContent(state)}
		</div>,
	);
}

type SessionPickerState = Pick<
	AppStateSnapshot,
	"activityText" | "currentSessionPath" | "sessions" | "sessionsHasMore"
>;

export function renderSessionPickerContent(state: SessionPickerState): string {
	return syncHtml(
		<div id="session-menu-content" class="session-menu-content">
			{state.sessions.map((session, index) => {
				const current = session.path === state.currentSessionPath;
				return renderSessionRow(
					session,
					index,
					current,
					current && Boolean(state.activityText),
				);
			})}
			{state.sessionsHasMore && (
				<div data-show="$sessionSearch === ''">{renderSessionPageTrigger()}</div>
			)}
		</div>,
	);
}

function sessionRowId(path: string): string {
	return `session-row-${encodeURIComponent(path)}`;
}

const currentSessionPickerClickAction = `
	const title = evt.target.closest('[data-session-rename-title]');
	if (title) {
		clearTimeout(Number(title.dataset.sessionPickerCloseTimer));
		title.dataset.sessionPickerCloseTimer = setTimeout(() => {
			document.getElementById('session-dialog')?.close();
		}, 300);
	} else {
		document.getElementById('session-dialog')?.close();
	}
`;

function renderSessionRow(
	session: AppSessionSummary,
	index: number,
	current: boolean,
	foregroundRunning: boolean,
): string {
	const haystack =
		`${session.title} ${formatMessageCount(session.messageCount)} ${session.path}`.toLowerCase();
	const displayStatus = foregroundRunning ? "running" : session.backgroundStatus;
	const shortcut = index < 9 && !current ? `ctrl ${index + 1}` : undefined;
	const deletable = displayStatus !== "running";
	return syncHtml(
		<div
			id={sessionRowId(session.path)}
			role="menuitem"
			tabindex="-1"
			aria-current={current ? "true" : undefined}
			data-preserve-attr="class hidden"
			data-keep-command-open
			data-filter={haystack}
			data-keywords={haystack}
			data-indicator:_session-loading
			data-attr:aria-disabled="$_sessionTransitionLoading ? 'true' : 'false'"
			data-on:click={
				current
					? currentSessionPickerClickAction
					: resumeSessionAction(session.path, { closeDialog: true })
			}
		>
			<span class="session-menu-heading">
				<span
					class={[
						"session-status-transition",
						!displayStatus && "session-status-empty",
					]}
				>
					{displayStatus && (
						<StatusDot
							class="session-menu-status"
							state={displayStatus === "running" ? "running" : "success"}
							label={sessionStatusLabel(displayStatus, current)}
						/>
					)}
				</span>
				{current ? (
					<SessionRenameTitle session={session} />
				) : (
					<span class="session-menu-title" safe>
						{session.title}
					</span>
				)}
				{current && <span class="selection-dot" aria-hidden="true" />}
				<DateTime dateTime={session.modifiedAt} label={session.modified} />
				{displayStatus === "running" && (
					<button
						type="button"
						class="btn session-menu-abort"
						data-variant="destructive"
						data-size="icon-xs"
						aria-label={`Abort ${current ? "current" : "background"} session ${session.title}`}
						data-on:click={
							current
								? `
						evt.stopPropagation();
						@post('${endpoints.abort}', { payload: {} });
						`
								: `
						evt.stopPropagation();
						$backgroundSessionPath = ${JSON.stringify(session.path)};
						@post('${endpoints.sessionsBackgroundAbort}', {
						payload: { backgroundSessionPath: $backgroundSessionPath },
						});
						`
						}
					>
						<Icon icon={Square} class="session-menu-abort-icon" />
					</button>
				)}
			</span>
			<span class="session-menu-meta">
				<SessionSubtitle session={session} class="session-menu-subtitle" />
				<SessionRowAction
					session={session}
					shortcut={shortcut}
					deletable={deletable}
				/>
			</span>
		</div>,
	);
}
