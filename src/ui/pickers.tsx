import type { FileSuggestion } from "../server/file-search.ts";
import { endpoints } from "../server/routes/endpoints.ts";
import type {
	AppRenderSnapshot,
	AppSessionSummary,
	AppSlashCommand,
} from "../state/app-store.ts";
import { formatHomePath } from "../utils/workspace.ts";
import {
	PickerEmpty,
	PickerList,
	PickerMetadata,
	PickerRow,
} from "./picker-components.tsx";
import { SessionSubtitle } from "./session-summary.tsx";
import { resumeSessionAction } from "./session-transition.tsx";

const bottomAnchoredPickerClass =
	"flex max-h-72 list-none flex-col-reverse overflow-y-auto p-1";

export function renderSlashPicker(state: AppRenderSnapshot): string {
	return (
		<div id="slash-picker">
			<PickerList id="slash-picker-list" class={bottomAnchoredPickerClass}>
				{state.slashCommands.length === 0 ? (
					<PickerEmpty>No prompts or skills found.</PickerEmpty>
				) : (
					state.slashCommands.map((item, index) =>
						renderSlashRow(item, index === 0),
					)
				)}
			</PickerList>
		</div>
	) as string;
}

function renderSlashRow(item: AppSlashCommand, selected: boolean): string {
	const label = `/${item.name}`;
	const haystack = `${item.name} ${item.description} ${item.source}`.toLowerCase();
	const commandText = `${label} `;
	return (
		<li
			role="option"
			tabindex="-1"
			class="rounded-md aria-selected:bg-muted"
			aria-selected={selected ? "true" : "false"}
			data-slash-row
			data-show={`
				$prompt.startsWith('/') &&
				!$prompt.includes(' ') &&
				(${JSON.stringify(haystack)}.includes($prompt.slice(1).toLowerCase()))
			`}
		>
			<button
				class="flex w-full items-center justify-between gap-4 rounded-md border-0 bg-transparent px-3 py-2 text-left outline-none hover:bg-muted focus:bg-muted"
				type="button"
				data-picker-kind="slash"
				data-picker-value={commandText}
			>
				<span class="min-w-0">
					<span class="block truncate">
						<span class="text-primary" safe>
							{label}
						</span>
						{item.argumentHint && (
							<span class="ml-2 text-muted-foreground" safe>
								{item.argumentHint}
							</span>
						)}
					</span>
					<span class="block truncate text-xs text-muted-foreground" safe>
						{item.description || item.source}
					</span>
				</span>
				<PickerMetadata text={item.source} />
			</button>
		</li>
	) as string;
}

export function renderWorkspaceDialogMenu(state: AppRenderSnapshot): string {
	const workspaces = uniqueWorkspaces([state.workspacePath, ...state.recentWorkspaces]);
	return (
		<div
			role="menu"
			id="workspace-menu"
			aria-orientation="vertical"
			data-empty="No matching workspaces."
		>
			<div role="group" aria-labelledby="workspace-open-heading">
				<span role="heading" id="workspace-open-heading">
					Open
				</span>
				<div
					role="menuitem"
					data-force
					data-workspace-submit
					data-indicator:_workspaceOpening
					data-indicator:_session-loading
					data-attr:aria-disabled="$sessionTransitionLoading ? 'true' : 'false'"
					data-on:click={openWorkspaceAction("$workspacePath")}
				>
					<span>Open typed path</span>
					<span
						class="text-xs text-muted-foreground"
						data-show="$_workspaceOpening"
						style="display: none"
					>
						Opening…
					</span>
					<span data-shortcut>Enter</span>
				</div>
			</div>
			<hr role="separator" />
			<div role="group" aria-labelledby="workspace-recent-heading">
				<span role="heading" id="workspace-recent-heading">
					Recent workspaces
				</span>
				{workspaces.map((workspacePath) =>
					renderWorkspaceRow(
						workspacePath,
						workspacePath === state.workspacePath,
					),
				)}
			</div>
		</div>
	) as string;
}

export function renderFilePickerResults(items: readonly FileSuggestion[]): string {
	return (
		<div id="file-picker-results" aria-live="polite">
			<PickerList id="file-picker-list" class={bottomAnchoredPickerClass}>
				{items.map((item, index) => (
					<PickerRow
						kind="file"
						value={item.value}
						label={item.label}
						description={item.description}
						metadata={item.isDirectory ? "dir" : "file"}
						selected={index === 0}
					/>
				))}
			</PickerList>
		</div>
	) as string;
}

function renderWorkspaceRow(workspacePath: string, current: boolean): string {
	const label = formatHomePath(workspacePath);
	return (
		<div
			role="menuitem"
			class="items-start gap-3"
			aria-current={current ? "true" : undefined}
			data-filter={`${label} ${workspacePath}`}
			data-keywords={`${label} ${workspacePath}`}
			data-indicator:_workspaceOpening
			data-indicator:_session-loading
			data-attr:aria-disabled="$sessionTransitionLoading ? 'true' : 'false'"
			data-on:click={openWorkspaceAction(JSON.stringify(workspacePath))}
		>
			<span class="mt-0.5 w-4 shrink-0 text-center text-primary" aria-hidden="true">
				{current ? "•" : ""}
			</span>
			<span class="min-w-0 truncate font-mono text-sm" safe>
				{label}
			</span>
		</div>
	) as string;
}

function openWorkspaceAction(valueExpression: string): string {
	return `if (!$sessionTransitionLoading) {
		$workspacePath = ${valueExpression};
		$_sessionTarget = $workspacePath;
		@post('${endpoints.workspaceOpen}', { filterSignals: { include: /^workspacePath$/ } });
	}`;
}

function uniqueWorkspaces(workspaces: string[]): string[] {
	const unique: string[] = [];
	for (const workspacePath of workspaces) {
		if (!workspacePath || unique.includes(workspacePath)) {
			continue;
		}
		unique.push(workspacePath);
	}
	return unique;
}

export function renderSessionPicker(state: AppRenderSnapshot): string {
	return (
		<div
			role="menu"
			id="session-menu"
			class="mt-1"
			aria-orientation="vertical"
			data-empty="No saved sessions for this project yet."
			data-signals:background-session-path__ifmissing="''"
		>
			{renderSessionPickerContent(state)}
		</div>
	) as string;
}

export function renderSessionPickerContent(state: AppRenderSnapshot): string {
	return (
		<div
			id="session-menu-content"
			role="group"
			aria-labelledby="session-menu-heading"
		>
			<span role="heading" id="session-menu-heading">
				Recent sessions
			</span>
			{state.sessions.map((session) => {
				const current = session.path === state.currentSessionPath;
				return renderSessionRow(
					session,
					current,
					current && Boolean(state.activityText),
				);
			})}
		</div>
	) as string;
}

function sessionRowId(path: string): string {
	return `session-row-${encodeURIComponent(path)}`;
}

function renderSessionRow(
	session: AppSessionSummary,
	current: boolean,
	foregroundRunning: boolean,
): string {
	const haystack = `${session.title} ${session.subtitle} ${session.path}`.toLowerCase();
	const displayStatus = foregroundRunning ? "running" : session.backgroundStatus;
	return (
		<div
			id={sessionRowId(session.path)}
			role="menuitem"
			tabindex="-1"
			class="group items-start! gap-2"
			aria-current={current ? "true" : undefined}
			data-keep-command-open
			data-session-row
			data-filter={haystack}
			data-keywords={haystack}
			data-indicator:_session-loading
			data-attr:aria-disabled="$sessionTransitionLoading ? 'true' : 'false'"
			data-on:click={
				current
					? "document.getElementById('session-dialog')?.close()"
					: resumeSessionAction(session.path, { closeDialog: true })
			}
		>
			<span class="min-w-0 flex-1">
				<span class="flex min-w-0 items-center gap-2">
					{current && (
						<span
							class="size-1.5 shrink-0 rounded-full bg-primary"
							data-current-session-indicator
							aria-hidden="true"
						></span>
					)}
					<span class="block min-w-0 truncate" safe>
						{session.title}
					</span>
				</span>
				<SessionSubtitle
					session={session}
					class="mt-1 line-clamp-2 text-xs text-muted-foreground"
				/>
			</span>
			<span class="mt-0.5 flex w-32 shrink-0 flex-col items-end gap-1 font-mono whitespace-nowrap">
				<span data-shortcut safe>
					{session.modified}
				</span>
				{displayStatus === "running" && (
					<span
						class="text-[0.6875rem] font-medium text-foreground"
						aria-label={
							current
								? "Current session running"
								: "Background session running"
						}
						data-background-status="running"
					>
						Running
					</span>
				)}
				{displayStatus === "completed" && (
					<span
						class="flex items-center gap-1 text-[0.6875rem] text-muted-foreground"
						aria-label="Background session completed"
						data-background-status="completed"
					>
						<svg
							class="size-3"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							stroke-width="2"
							stroke-linecap="round"
							stroke-linejoin="round"
							aria-hidden="true"
						>
							<path d="m5 12 4 4L19 6" />
						</svg>
						Completed
					</span>
				)}
			</span>
			{displayStatus === "running" && (
				<button
					type="button"
					class="btn shrink-0 leading-none"
					data-variant="destructive"
					data-size="icon-xs"
					aria-label={`Abort ${current ? "current" : "background"} session ${session.title}`}
					data-on:click={
						current
							? `
					evt.stopPropagation();
					@post('${endpoints.abort}', { filterSignals: { include: /^$/ } });
					`
							: `
					evt.stopPropagation();
					$backgroundSessionPath = ${JSON.stringify(session.path)};
					@post('${endpoints.sessionsBackgroundAbort}', {
					filterSignals: { include: /^backgroundSessionPath$/ },
					});
					`
					}
				>
					<svg
						class="size-3 fill-destructive! text-destructive!"
						viewBox="0 0 24 24"
						aria-hidden="true"
					>
						<rect x="3" y="3" width="18" height="18" rx="2" />
					</svg>
				</button>
			)}
			{displayStatus !== "running" && (
				<button
					type="button"
					class="btn shrink-0 opacity-35 group-[.active]:opacity-100 hover:opacity-100 focus-visible:opacity-100 disabled:invisible"
					data-variant="ghost"
					data-attr:data-variant={`$sessionDeleteHover === ${JSON.stringify(session.path)} ? 'destructive' : 'ghost'`}
					data-size="icon-xs"
					aria-label="Delete session"
					data-on:mouseenter={`$sessionDeleteHover = ${JSON.stringify(session.path)}`}
					data-on:mouseleave="$sessionDeleteHover = ''"
					data-on:focus={`$sessionDeleteHover = ${JSON.stringify(session.path)}`}
					data-on:blur="$sessionDeleteHover = ''"
					data-on:click={`
						evt.stopPropagation();
						$sessionDeletePath = ${JSON.stringify(session.path)};
						$sessionDeleteTitle = ${JSON.stringify(session.title)};
						document.getElementById('session-delete-dialog')?.showModal();
					`}
				>
					<svg
						xmlns="http://www.w3.org/2000/svg"
						class="text-current!"
						viewBox="0 0 24 24"
						fill="none"
						stroke="currentColor"
						stroke-width="2"
						stroke-linecap="round"
						stroke-linejoin="round"
						aria-hidden="true"
					>
						<path d="M10 11v6" />
						<path d="M14 11v6" />
						<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
						<path d="M3 6h18" />
						<path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
					</svg>
				</button>
			)}
		</div>
	) as string;
}
