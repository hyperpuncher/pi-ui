import type { FileSuggestion } from "../server/file-search.ts";
import { endpoints } from "../server/routes/endpoints.ts";
import type { WorkspaceSuggestion } from "../server/workspace-search.ts";
import type {
	AppRenderSnapshot,
	AppSessionSummary,
	AppSlashCommand,
} from "../state/app-store.ts";
import { formatHomePath } from "../utils/workspace.ts";
import { StopIcon } from "./icon.tsx";
import {
	PickerEmpty,
	PickerList,
	PickerMetadata,
	PickerRow,
} from "./picker-components.tsx";
import { SessionRowAction } from "./session-row-action.tsx";
import { sessionStatusLabel } from "./session-status.ts";
import { SessionSubtitle } from "./session-summary.tsx";
import { resumeSessionAction } from "./session-transition.tsx";
import { StatusDot } from "./status-dot.tsx";

const bottomAnchoredPickerClass =
	"flex max-h-72 list-none flex-col-reverse overflow-y-auto p-1";

export function slashPickerOpenExpression(state: AppRenderSnapshot): string {
	const haystacks = state.slashCommands.map(slashCommandHaystack);
	return `$prompt.startsWith('/') &&
		!$prompt.includes(' ') &&
		${JSON.stringify(haystacks)}.some((candidate) =>
			candidate.includes($prompt.slice(1).toLowerCase())
		)`;
}

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

function slashCommandHaystack(item: AppSlashCommand): string {
	return `${item.name} ${item.description} ${item.source}`.toLowerCase();
}

function renderSlashRow(item: AppSlashCommand, selected: boolean): string {
	const label = `/${item.name}`;
	const haystack = slashCommandHaystack(item);
	return (
		<li
			role="option"
			tabindex="-1"
			class="rounded-md aria-selected:bg-muted"
			aria-selected={selected ? "true" : "false"}
			data-slash-row
			data-show={`
				$_slashPickerOpen &&
				(${JSON.stringify(haystack)}.includes($prompt.slice(1).toLowerCase()))
			`}
		>
			<button
				class="flex w-full items-center justify-between gap-4 rounded-md border-0 bg-transparent px-3 py-2 text-left outline-none hover:bg-muted focus:bg-muted"
				type="button"
				data-picker-kind="slash"
				data-on:click={`
					window.piUi.messageScroll.scrollBottom();
					$prompt = '';
					if (${JSON.stringify(label)} === '/tree') window.piUi.dialogs.openTree();
					@post('${endpoints.prompt}', { payload: { prompt: ${JSON.stringify(label)} } });
				`}
			>
				<span class="min-w-0">
					<span class="block truncate font-mono">
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
		<div role="menu" id="workspace-menu" aria-orientation="vertical">
			{renderWorkspaceSearchResults(workspaces, [], state.workspacePath)}
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

export function renderWorkspaceSearchResults(
	recentWorkspaces: readonly string[],
	searchWorkspaces: readonly WorkspaceSuggestion[],
	currentWorkspacePath: string,
): string {
	const recent = uniqueWorkspaces(recentWorkspaces);
	const search = uniqueWorkspaces(
		searchWorkspaces.map((workspace) => workspace.path),
	).filter((workspacePath) => !recent.includes(workspacePath));
	return (
		<div id="workspace-search-results">
			{recent.length > 0 &&
				renderWorkspaceGroup("Recent workspaces", recent, currentWorkspacePath)}
			{search.length > 0 &&
				renderWorkspaceGroup("Search results", search, currentWorkspacePath)}
		</div>
	) as string;
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
	return (
		<div role="group" aria-labelledby={id}>
			<span role="heading" id={id}>
				{heading}
			</span>
			{workspaces.map((workspacePath) =>
				renderWorkspaceRow(workspacePath, workspacePath === currentWorkspacePath),
			)}
		</div>
	) as string;
}

function renderWorkspaceRow(workspacePath: string, current: boolean): string {
	const label = formatHomePath(workspacePath);
	return (
		<div
			role="menuitem"
			class="items-start gap-3"
			tabindex="-1"
			aria-current={current ? "true" : undefined}
			data-filter={`${label} ${workspacePath}`}
			data-keywords={`${label} ${workspacePath}`}
			data-indicator:_session-loading
			data-attr:aria-disabled="$_sessionTransitionLoading ? 'true' : 'false'"
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
	return `if (!$_sessionTransitionLoading) {
		$workspacePath = ${valueExpression};
		@post('${endpoints.workspaceOpen}', { filterSignals: { include: /^workspacePath$/ } });
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

export function renderSessionPicker(state: AppRenderSnapshot): string {
	return (
		<div
			role="menu"
			id="session-menu"
			class="mt-1 max-h-96!"
			aria-orientation="vertical"
			data-empty="No matching sessions."
			data-signals:background-session-path__ifmissing="''"
		>
			{renderSessionPickerContent(state)}
		</div>
	) as string;
}

type SessionPickerState = Pick<
	AppRenderSnapshot,
	"activityText" | "currentSessionPath" | "sessions"
>;

export function renderSessionPickerContent(state: SessionPickerState): string {
	return (
		<div id="session-menu-content" class="px-1">
			{state.sessions.map((session, index) => {
				const current = session.path === state.currentSessionPath;
				return renderSessionRow(
					session,
					index,
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
	index: number,
	current: boolean,
	foregroundRunning: boolean,
): string {
	const haystack = `${session.title} ${session.subtitle} ${session.path}`.toLowerCase();
	const displayStatus = foregroundRunning ? "running" : session.backgroundStatus;
	const shortcut = index < 9 && !current ? `ctrl ${index + 1}` : undefined;
	const deletable = displayStatus !== "running";
	return (
		<div
			id={sessionRowId(session.path)}
			role="menuitem"
			tabindex="-1"
			class={["group block!", current && "bg-foreground! text-background!"]}
			aria-current={current ? "true" : undefined}
			data-keep-command-open
			data-session-row
			data-filter={haystack}
			data-keywords={haystack}
			data-indicator:_session-loading
			data-attr:aria-disabled="$_sessionTransitionLoading ? 'true' : 'false'"
			data-on:click={
				current
					? "document.getElementById('session-dialog')?.close()"
					: resumeSessionAction(session.path, { closeDialog: true })
			}
		>
			<span class="flex items-center gap-2">
				{displayStatus && (
					<StatusDot
						class="ml-0.75"
						state={displayStatus === "running" ? "running" : "success"}
						label={sessionStatusLabel(displayStatus, current)}
						dataStatus={displayStatus}
						runningClass={current ? "text-background/65" : undefined}
					/>
				)}
				<span class="min-w-0 flex-1 truncate font-medium" safe>
					{session.title}
				</span>
				<span
					class={[
						"shrink-0 text-[10px] whitespace-nowrap lowercase",
						current ? "text-background/65" : "text-muted-foreground",
					]}
					safe
				>
					{session.modified}
				</span>
				{displayStatus === "running" && (
					<button
						type="button"
						class="btn shrink-0"
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
						<StopIcon class="size-3 text-destructive!" />
					</button>
				)}
			</span>
			<span class="flex h-6 items-center gap-2">
				<SessionSubtitle
					session={session}
					class={[
						"min-w-0 flex-1 text-xs",
						current ? "text-background/65" : "text-muted-foreground",
					]}
				/>
				<SessionRowAction
					session={session}
					shortcut={shortcut}
					deletable={deletable}
				/>
			</span>
		</div>
	) as string;
}
