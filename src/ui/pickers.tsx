import type { AppSessionSummary, AppSlashCommand, AppState } from "../state/app-state.ts";

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
				{state.sessions.map(renderSessionRow)}
			</div>
		</div>
	) as string;
}

function renderSessionRow(session: AppSessionSummary): string {
	const haystack = `${session.title} ${session.subtitle} ${session.path}`.toLowerCase();
	return (
		<div
			role="menuitem"
			tabindex="-1"
			class="items-start gap-4"
			data-session-row
			data-filter={haystack}
			data-keywords={haystack}
			data-on:click={`
				document.getElementById('session-dialog')?.close();
				$sessionPath = ${JSON.stringify(session.path)};
				@post('/sessions/resume', { filterSignals: { include: /^sessionPath$/ } });
			`}
		>
			<span class="min-w-0 flex-1">
				<span class="block truncate" safe>
					{session.title}
				</span>
				<span class="text-muted-foreground mt-1 line-clamp-2 text-xs" safe>
					{session.subtitle}
				</span>
			</span>
			<span class="w-32 shrink-0 text-right whitespace-nowrap" data-shortcut safe>
				{session.modified}
			</span>
		</div>
	) as string;
}
