import { endpoints } from "../server/routes/endpoints.ts";
import type { AppSessionSummary, AppStateSnapshot } from "../state/app-store.ts";
import { calendarDayDifference } from "../utils/date-time-format.ts";
import { systemTimeLocale } from "../utils/locale.ts";
import { DateTime } from "./date-time.tsx";
import { loaderIcon } from "./prompt-status.tsx";
import { SessionRenameTitle } from "./session-rename.tsx";
import { SessionRowAction } from "./session-row-action.tsx";
import { sessionStatusLabel } from "./session-status.ts";
import { SessionSubtitle } from "./session-summary.tsx";
import {
	resumeSessionAction,
	resumeSessionShortcutAction,
} from "./session-transition.tsx";
import { StatusDot } from "./status-dot.tsx";
import { syncHtml } from "./sync-html.ts";

type SessionSidebarState = Pick<
	AppStateSnapshot,
	| "activityText"
	| "currentSessionPath"
	| "sessionCatalogLoading"
	| "sessionSidebarHasMore"
	| "sessionSidebarSessions"
	| "sessions"
>;

export function renderSessionSidebar(state: SessionSidebarState): string {
	return syncHtml(
		<aside
			id="session-sidebar"
			class="sidebar group/sidebar"
			data-side="right"
			data-initial-open={state.sessions.length === 0 && "false"}
			aria-keyshortcuts="Control+B Meta+B"
			data-signals:session-delete-hover__ifmissing="''"
		>
			<div
				id="session-sidebar-separator"
				class="pi-resize-handle fixed! inset-y-(--pi-workspace-inset)! z-50 w-(--pi-workspace-gap)! max-md:hidden group-aria-[hidden=true]/sidebar:hidden!"
				style="right: calc(var(--sidebar-width) + var(--pi-workspace-inset) - var(--pi-workspace-gap));"
				role="separator"
				tabindex="0"
				aria-label="Resize sessions and chat"
				aria-orientation="vertical"
				aria-valuemin="224"
				aria-valuemax="480"
				aria-valuenow="288"
				data-on:click__stop="true"
			></div>
			<nav
				class="pi-raised-surface inset-y-(--pi-workspace-inset)! right-(--pi-workspace-inset)! w-[calc(var(--sidebar-mobile-width)-var(--pi-workspace-gap))] transition-transform duration-150 ease-(--pi-ease-out) motion-reduce:transition-none md:w-[calc(var(--sidebar-width)-var(--pi-workspace-gap))]"
				aria-label="Sessions"
			>
				<section>
					<div role="group" aria-label="Recent sessions">
						{renderSessionSidebarContent(state)}
					</div>
				</section>
			</nav>
		</aside>,
	);
}

export function renderSessionSidebarContent(state: SessionSidebarState): string {
	const sessions = state.sessionSidebarSessions;
	const groups = groupSessionsByDate(sessions);
	return syncHtml(
		<div id="session-sidebar-content">
			{groups.map((group) => (
				<div>
					{group.label && (
						<h3
							id={`session-sidebar-${group.key}`}
							class="flex h-auto items-center gap-2 px-2 py-1 text-[10px] font-medium tracking-wide text-muted-foreground lowercase"
						>
							<span>{group.label}</span>
							<span
								class="flex-1 border-t border-border"
								aria-hidden="true"
							/>
						</h3>
					)}
					<ul>
						{group.sessions.map(({ session, index }) =>
							renderSessionSidebarRow(
								session,
								index,
								state,
								group.showRowDate,
							),
						)}
					</ul>
				</div>
			))}
			{state.sessionCatalogLoading && (
				<div class="flex justify-center px-2 py-4 text-muted-foreground">
					{loaderIcon()}
				</div>
			)}
			{state.sessionSidebarHasMore && renderSessionPageTrigger()}
		</div>,
	);
}

export function sessionSidebarRowId(path: string): string {
	return `session-sidebar-row-${encodeURIComponent(path)}`;
}

function renderSessionPageTrigger() {
	return (
		<div
			class="flex min-h-8 items-center justify-center text-muted-foreground"
			data-indicator:_session-page-loading
			data-on-intersect__once={`@post('${endpoints.sessionsMore}', { payload: {} })`}
		>
			<span
				data-show="$_sessionPageLoading"
				style="display: none"
				aria-live="polite"
			>
				{loaderIcon()}
			</span>
		</div>
	);
}

type SessionDateGroup = {
	key: string;
	label: string | undefined;
	showRowDate: boolean;
	sessions: Array<{ session: AppSessionSummary; index: number }>;
};

function groupSessionsByDate(
	sessions: readonly AppSessionSummary[],
	now = new Date(),
): SessionDateGroup[] {
	const groups = new Map<string, SessionDateGroup>();
	for (const [index, session] of sessions.entries()) {
		const date = sessionDate(session.modifiedAt);
		const key = date ? localDateKey(date) : "unknown";
		let group = groups.get(key);
		if (!group) {
			const difference = date ? calendarDayDifference(date, now) : undefined;
			group = {
				key,
				label:
					date && difference !== undefined
						? sessionGroupLabel(date, difference, now)
						: "Unknown date",
				showRowDate: difference === 0 || difference === undefined,
				sessions: [],
			};
			groups.set(key, group);
		}
		group.sessions.push({ session, index });
	}
	return [...groups.values()];
}

function sessionDate(dateTime: string | undefined): Date | undefined {
	if (!dateTime) return undefined;
	const date = new Date(dateTime);
	return Number.isNaN(date.getTime()) ? undefined : date;
}

function localDateKey(date: Date): string {
	return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

function sessionGroupLabel(
	date: Date,
	difference: number,
	now: Date,
): string | undefined {
	if (difference === 0) return undefined;
	if (difference === 1) return "Yesterday";
	if (difference > 1 && difference < 7) {
		return date.toLocaleDateString(systemTimeLocale, { weekday: "long" });
	}
	return date.toLocaleDateString(systemTimeLocale, {
		month: "short",
		day: "numeric",
		year: date.getFullYear() === now.getFullYear() ? undefined : "numeric",
	});
}

function renderSessionSidebarRow(
	session: AppSessionSummary,
	index: number,
	state: SessionSidebarState,
	showDate: boolean,
): string {
	const current = session.path === state.currentSessionPath;
	const status = current && state.activityText ? "running" : session.backgroundStatus;
	const shortcut = index < 9 ? `ctrl ${index + 1}` : undefined;
	const deletable = status !== "running";
	return syncHtml(
		<li id={sessionSidebarRowId(session.path)} class="group relative">
			<button
				type="button"
				class="absolute! inset-0 h-full! p-0!"
				data-size="lg"
				data-active={current ? "true" : undefined}
				aria-current={current ? "true" : undefined}
				aria-label={session.title}
				data-indicator:_session-loading
				data-attr:aria-disabled="$_sessionTransitionLoading ? 'true' : 'false'"
				data-on:click={current ? undefined : resumeSessionAction(session.path)}
				data-on:keydown__window={
					shortcut && !current
						? resumeSessionShortcutAction(session.path, index)
						: undefined
				}
			></button>
			<span class="pointer-events-none relative z-10 flex min-w-0 flex-col gap-1 p-2">
				<span class="flex min-w-0 items-center gap-2">
					{status && (
						<StatusDot
							class="ml-0.75"
							state={status === "running" ? "running" : "success"}
							label={sessionStatusLabel(status, current)}
						/>
					)}
					{current ? (
						<SessionRenameTitle session={session} />
					) : (
						<span
							class="min-w-0 flex-1 truncate text-[13px] text-muted-foreground"
							safe
						>
							{session.title}
						</span>
					)}
					{showDate && (
						<DateTime
							dateTime={session.modifiedAt}
							label={session.modified}
						/>
					)}
				</span>
				<span class="flex h-6 min-w-0 items-center gap-2">
					<SessionSubtitle
						session={session}
						class="pi-fine-print min-w-0 flex-1 overflow-hidden text-xs"
						workspaceNameOnly
						showSubtitle={false}
					/>
					<SessionRowAction
						session={session}
						shortcut={current ? undefined : shortcut}
						deletable={deletable}
					/>
				</span>
			</span>
		</li>,
	);
}
