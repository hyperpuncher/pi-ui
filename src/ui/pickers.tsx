import type { AppSessionSummary, AppSlashCommand, AppState } from "../state/app-state.ts";
import { formatHomePath } from "../utils/workspace.ts";

export function renderSlashPicker(state: AppState): string {
	return (
		<div id="slash-picker">
			<ul class="max-h-72 list-none overflow-y-auto p-1">
				{state.slashCommands.length === 0 ? (
					<li class="text-muted-foreground px-3 py-4 text-center text-sm">
						No prompts or skills found.
					</li>
				) : (
					state.slashCommands.map(renderSlashRow)
				)}
			</ul>
		</div>
	) as string;
}

function renderSlashRow(item: AppSlashCommand): string {
	const label = `/${item.name}`;
	const haystack = `${item.name} ${item.description} ${item.source}`.toLowerCase();
	const commandText = `${label} `;
	return (
		<li data-slash-row data-slash-haystack={haystack}>
			<button
				class="hover:bg-muted focus:bg-muted flex w-full items-center justify-between gap-4 rounded-md border-0 bg-transparent px-3 py-2 text-left outline-none"
				type="button"
				data-slash-command={commandText}
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
				<span class="badge" data-variant="secondary" safe>
					{item.source}
				</span>
			</button>
		</li>
	) as string;
}

export function renderWorkspaceDialogMenu(state: AppState): string {
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
					data-on:click={openWorkspaceAction("$workspacePath")}
				>
					<span>Open typed path</span>
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

function renderWorkspaceRow(workspacePath: string, current: boolean): string {
	const label = formatHomePath(workspacePath);
	return (
		<div
			role="menuitem"
			class={["items-start gap-3", current && "bg-muted"]}
			aria-current={current ? "true" : undefined}
			data-filter={`${label} ${workspacePath}`}
			data-keywords={`${label} ${workspacePath}`}
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
	return `
		$workspacePath = ${valueExpression};
		@post('/workspace/open', { filterSignals: { include: /^workspacePath$/ } });
	`;
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

export function renderSessionPicker(state: AppState): string {
	return (
		<div
			role="menu"
			id="session-menu"
			class="mt-1"
			aria-orientation="vertical"
			data-empty="No saved sessions for this project yet."
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
			data-on:click={`
				document.getElementById('session-dialog')?.close();
				$isSessionReady = false;
				$sessionPath = ${JSON.stringify(session.path)};
				@post('/sessions/resume', { filterSignals: { include: /^sessionPath$/ } });
			`}
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
			<span
				class="mt-0.5 w-32 shrink-0 text-right whitespace-nowrap"
				data-shortcut
				safe
			>
				{session.modified}
			</span>
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
		</div>
	) as string;
}
