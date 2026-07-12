import type { FileSuggestion } from "../server/file-search.ts";
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
import { resumeSessionAction } from "./session-transition.tsx";

export function renderSlashPicker(state: AppRenderSnapshot): string {
	return (
		<div id="slash-picker">
			<PickerList id="slash-picker-list">
				{state.slashCommands.length === 0 ? (
					<PickerEmpty>No prompts or skills found.</PickerEmpty>
				) : (
					state.slashCommands.map(renderSlashRow)
				)}
			</PickerList>
		</div>
	) as string;
}

function renderSlashRow(item: AppSlashCommand): string {
	const label = `/${item.name}`;
	const haystack = `${item.name} ${item.description} ${item.source}`.toLowerCase();
	const commandText = `${label} `;
	return (
		<li
			role="option"
			tabindex="-1"
			aria-selected="false"
			data-slash-row
			data-show={`
				$prompt.startsWith('/') &&
				!$prompt.includes(' ') &&
				(${JSON.stringify(haystack)}.includes($prompt.slice(1).toLowerCase()))
			`}
		>
			<button
				class="hover:bg-muted focus:bg-muted flex w-full items-center justify-between gap-4 rounded-md border-0 bg-transparent px-3 py-2 text-left outline-none"
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
							<span class="text-muted-foreground ml-2" safe>
								{item.argumentHint}
							</span>
						)}
					</span>
					<span class="text-muted-foreground block truncate text-xs" safe>
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
						class="text-muted-foreground text-xs"
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
			<PickerList id="file-picker-list">
				{items.length === 0 ? (
					<PickerEmpty>No files found.</PickerEmpty>
				) : (
					[...items]
						.reverse()
						.map((item) => (
							<PickerRow
								kind="file"
								value={item.value}
								label={item.label}
								description={item.description}
								metadata={item.isDirectory ? "dir" : "file"}
							/>
						))
				)}
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
			<span class="text-primary mt-0.5 w-4 shrink-0 text-center" aria-hidden="true">
				{current ? "•" : ""}
			</span>
			<span class="min-w-0">
				<span class="block truncate font-mono text-sm" safe>
					{label}
				</span>
				<span class="text-muted-foreground mt-1 block truncate text-xs" safe>
					{workspacePath}
				</span>
			</span>
		</div>
	) as string;
}

function openWorkspaceAction(valueExpression: string): string {
	return `if (!$sessionTransitionLoading) {
		$workspacePath = ${valueExpression};
		$_sessionTarget = $workspacePath;
		@post('/workspace/open', { filterSignals: { include: /^workspacePath$/ } });
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
			<div role="group" aria-labelledby="session-menu-heading">
				<span role="heading" id="session-menu-heading">
					Recent sessions
				</span>
				{state.sessions.map((session) =>
					renderSessionRow(session, session.path === state.currentSessionPath),
				)}
			</div>
		</div>
	) as string;
}

function renderSessionRow(session: AppSessionSummary, current: boolean): string {
	const haystack = `${session.title} ${session.subtitle} ${session.path}`.toLowerCase();
	return (
		<div
			role="menuitem"
			tabindex="-1"
			class="group items-start! gap-3"
			aria-current={current ? "true" : undefined}
			data-keep-command-open
			data-session-row
			data-filter={haystack}
			data-keywords={haystack}
			data-indicator:_session-loading
			data-attr:aria-disabled="$sessionTransitionLoading ? 'true' : 'false'"
			data-on:click={resumeSessionAction(session.path, { closeDialog: true })}
		>
			<span class="text-primary mt-0.5 w-4 shrink-0 text-center" aria-hidden="true">
				{current ? "•" : ""}
			</span>
			<span class="min-w-0 flex-1">
				<span class="block truncate" safe>
					{session.title}
				</span>
				<span class="text-muted-foreground mt-1 line-clamp-2 text-xs" safe>
					{session.subtitle}
				</span>
			</span>
			<span class="mt-0.5 flex w-32 shrink-0 flex-col items-end gap-1 whitespace-nowrap">
				<span data-shortcut safe>
					{session.modified}
				</span>
				{session.backgroundStatus === "running" && (
					<span
						class="text-foreground flex items-center gap-1.5 text-[0.6875rem] font-medium"
						aria-label="Background session running"
						data-background-status="running"
					>
						<span
							class="bg-primary size-1.5 rounded-full"
							aria-hidden="true"
						></span>
						Running
					</span>
				)}
				{session.backgroundStatus === "completed" && (
					<span
						class="text-muted-foreground flex items-center gap-1 text-[0.6875rem]"
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
			{session.backgroundStatus === "running" && (
				<button
					type="button"
					class="btn shrink-0 leading-none"
					data-variant="destructive"
					data-size="icon-xs"
					aria-label={`Abort background session ${session.title}`}
					data-on:click={`
						evt.stopPropagation();
						$backgroundSessionPath = ${JSON.stringify(session.path)};
						@post('/sessions/background/abort', {
							filterSignals: { include: /^backgroundSessionPath$/ },
						});
					`}
				>
					<svg
						class="text-destructive! fill-destructive! size-3"
						viewBox="0 0 24 24"
						aria-hidden="true"
					>
						<rect x="3" y="3" width="18" height="18" rx="2" />
					</svg>
				</button>
			)}
			{session.backgroundStatus !== "running" && (
				<button
					type="button"
					class="btn shrink-0 opacity-35 group-[.active]:opacity-100 hover:opacity-100 focus-visible:opacity-100 disabled:invisible"
					data-variant="ghost"
					data-attr:data-variant={`$sessionDeleteHover === ${JSON.stringify(session.path)} ? 'destructive' : 'ghost'`}
					data-size="icon-xs"
					aria-label="Delete session"
					disabled={current ? true : undefined}
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
