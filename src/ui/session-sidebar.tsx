import { endpoints } from "../server/routes/endpoints.ts";
import type { AppRenderSnapshot, AppSessionSummary } from "../state/app-store.ts";
import { systemTimeLocale } from "../utils/locale.ts";
import { DateTime } from "./date-time.tsx";
import { loaderIcon } from "./prompt-status.tsx";
import { SessionRowAction } from "./session-row-action.tsx";
import { sessionStatusLabel } from "./session-status.ts";
import { SessionSubtitle } from "./session-summary.tsx";
import {
	resumeSessionAction,
	resumeSessionShortcutAction,
} from "./session-transition.tsx";
import { StatusDot } from "./status-dot.tsx";

type SessionSidebarState = Pick<
	AppRenderSnapshot,
	"activityText" | "currentSessionPath" | "sessionCatalogLoading" | "sessions"
>;

type SessionSidebarContentOptions = {
	hasMoreSessions?: boolean;
};

export const sessionSidebarPageSize = 30;

export function renderSessionSidebar(state: SessionSidebarState): string {
	return (
		<aside
			id="session-sidebar"
			class="sidebar"
			data-side="right"
			data-initial-open={state.sessions.length === 0 && "false"}
			aria-keyshortcuts="Control+B Meta+B"
		>
			<div
				id="session-sidebar-separator"
				class="pi-resize-handle fixed! inset-y-(--pi-workspace-inset)! z-50 w-(--pi-workspace-gap)! max-md:hidden"
				style="right: calc(var(--sidebar-width) + var(--pi-workspace-inset) - var(--pi-workspace-gap));"
				role="separator"
				tabindex="0"
				aria-label="Resize sessions and chat"
				aria-orientation="vertical"
				aria-valuemin="224"
				aria-valuemax="480"
				aria-valuenow="288"
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
		</aside>
	) as string;
}

export function renderSessionSidebarContent(
	state: SessionSidebarState,
	options: SessionSidebarContentOptions = {},
): string {
	const sessions =
		options.hasMoreSessions === undefined
			? state.sessions.slice(0, sessionSidebarPageSize)
			: state.sessions;
	const groups = groupSessionsByDate(sessions);
	const hasMoreSessions =
		options.hasMoreSessions ??
		(!state.sessionCatalogLoading && state.sessions.length >= sessionSidebarPageSize);
	return (
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
			{hasMoreSessions && renderSessionPageTrigger(sessions.length)}
		</div>
	) as string;
}

function renderSessionPageTrigger(loadedCount: number) {
	const nextLimit = loadedCount + sessionSidebarPageSize;
	return (
		<div
			class="flex min-h-8 items-center justify-center text-muted-foreground"
			data-indicator:_session-page-loading
			data-on-intersect__once={`@get('${endpoints.sessionsMore}?limit=${nextLimit}', { filterSignals: { include: /^$/ } })`}
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

function calendarDayDifference(date: Date, now: Date): number {
	const dateDay = Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
	const nowDay = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate());
	return Math.round((nowDay - dateDay) / 86_400_000);
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
	return (
		<li class="group relative">
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
							dataStatus={status}
						/>
					)}
					<span
						class={[
							"min-w-0 flex-1 truncate text-[13px]",
							current
								? "font-medium text-foreground"
								: "text-muted-foreground",
						]}
						safe
					>
						{session.title}
					</span>
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
		</li>
	) as string;
}
