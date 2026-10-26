import { activeKeybind, keybindActions, keybindAria } from "#src/keybinds.ts";
import { endpoints } from "#src/server/routes/endpoints.ts";
import {
	sessionSidebarWidthDefault,
	sessionSidebarWidthMax,
	sessionSidebarWidthMin,
} from "#src/session-sidebar-types.ts";
import {
	type AppSessionSummary,
	type AppStateSnapshot,
	sessionStatus,
} from "#src/state/app-store.ts";
import { DateTime } from "#src/ui/date-time.tsx";
import { Icon } from "#src/ui/icon.tsx";
import { ShortcutKbd } from "#src/ui/keyboard.tsx";
import { loaderIcon } from "#src/ui/prompt-status.tsx";
import { SessionRenameTitle } from "#src/ui/session-rename.tsx";
import { SessionRowAction } from "#src/ui/session-row-action.tsx";
import { sessionStatusLabel } from "#src/ui/session-status.ts";
import { SessionSubtitle } from "#src/ui/session-summary.tsx";
import {
	resumeSessionAction,
	resumeSessionShortcutAction,
} from "#src/ui/session-transition.tsx";
import { StatusDot } from "#src/ui/status-dot.tsx";
import { syncHtml } from "#src/ui/sync-html.ts";
import { calendarDayDifference, formatCalendarDay } from "#src/utils/date-time-format.ts";
import { systemTimeLocale } from "#src/utils/locale.ts";

const sidebarPointerWidthExpression = `Math.round(Math.min(
	Math.max(${sessionSidebarWidthMin}, Math.min(${sessionSidebarWidthMax}, innerWidth * 0.5)),
	Math.max(${sessionSidebarWidthMin}, $_sessionSidebarWidth + $_sessionSidebarPointerX - evt.clientX),
))`;
const sidebarResizeFinish = `document.documentElement.classList.remove('is-resizing');
@post('${endpoints.sessionSidebar}', { payload: { sessionSidebar: { width: $_sessionSidebarWidth } } });`;
// Shared by the inline restore script and the breakpoint-change handler.
function restoreSessionSidebar(desktopOpen: boolean): string {
	return `
	el.removeAttribute('data-animate-open');
	el.close();
	const mobile = matchMedia('(width <= 48rem)').matches;
	el.closedBy = mobile ? 'any' : 'none';
	if (!mobile && ${desktopOpen}) el.show();
	el.querySelector('.session-sidebar-scroller').scrollLeft = 0;
`;
}
const focusSessionSidebarShortcut = `el.dispatchEvent(new CommandEvent('command', { command: '--show' }));
	const target = el.querySelector(
		'li > button[aria-current="true"], li > button[data-active="true"], li > button',
	) ?? el.querySelector('nav');
	const group = target?.closest('details');
	if (group) group.open = true;
	target?.focus({ preventScroll: true });`;

type SessionSidebarState = Pick<
	AppStateSnapshot,
	| "activityText"
	| "currentSessionPath"
	| "sessionCatalogLoading"
	| "sessionSidebarArchive"
	| "sessionSidebarArchiveAfterDays"
	| "sessions"
	| "sessionsHasMore"
>;

export function renderSessionSidebar(
	state: SessionSidebarState,
	options: { open?: boolean; width?: number } = {},
): string {
	const desktopOpen = options.open ?? true;
	const width = options.width ?? sessionSidebarWidthDefault;
	return syncHtml(
		<>
			<dialog
				id="session-sidebar"
				class="session-sidebar"
				style={`--session-sidebar-preferred-width: ${width}px;`}
				aria-label="Sessions"
				closedby="any"
				aria-keyshortcuts={keybindAria("toggle-sessions")}
				data-signals:_session-sidebar-open__ifmissing="el.open"
				data-on:toggle={`$_sessionSidebarOpen = el.open`}
				data-on:command={`
					if (evt.command === '--toggle' && el.open) el.close();
					else if (evt.command === '--toggle' || evt.command === '--show') {
						el.toggleAttribute(
							'data-animate-open',
							evt.source !== null && !evt.source.matches(':focus-visible'),
						);
						if (!el.open) el.closedBy === 'any' ? el.showModal() : el.show();
						el.querySelector('.session-sidebar-scroller').scrollLeft = 0;
					}
					if (evt.command === '--toggle' && el.closedBy !== 'any')
						@post('${endpoints.sessionSidebar}', {
							payload: { sessionSidebar: { open: el.open } },
						});
				`}
				data-on:resize__window={`if (matchMedia('(width <= 48rem)').matches !== (el.closedBy === 'any')) {
				${restoreSessionSidebar(desktopOpen)}
				}`}
				data-on:click={`
					if (!el.matches(':modal')) return;
					const row = evt.target.closest('.session-sidebar-row-button');
					if (row && row.getAttribute('aria-disabled') !== 'true') el.close();
					if (!('closedBy' in HTMLDialogElement.prototype) && evt.target === el) el.close();
				`}
				data-signals:_session-sidebar-width__ifmissing={String(width)}
				data-style={`{ '--session-sidebar-preferred-width': $_sessionSidebarWidth + 'px' }`}
				data-signals:_session-sidebar-pointer-x__ifmissing="0"
				data-on:keydown__window={keybindActions(
					[
						"toggle-sessions",
						"el.dispatchEvent(new CommandEvent('command', { command: '--toggle' }));",
					],
					["focus-sessions", focusSessionSidebarShortcut],
				)}
			>
				<div
					id="session-sidebar-separator"
					class="resize-handle session-sidebar-resize"
					aria-hidden="true"
					data-on:click__stop="true"
					data-on:pointerdown__prevent={`if (evt.button === 0) {
						$_sessionSidebarPointerX = evt.clientX;
						el.setPointerCapture(evt.pointerId);
						document.documentElement.classList.add('is-resizing');
					}`}
					{...{
						"data-on:pointermove__throttle.8ms": `if (el.hasPointerCapture(evt.pointerId)) {
						$_sessionSidebarWidth = ${sidebarPointerWidthExpression};
						$_sessionSidebarPointerX = evt.clientX;
					}`,
					}}
					data-on:pointerup={sidebarResizeFinish}
					data-on:pointercancel={sidebarResizeFinish}
					data-on:dblclick={`
						$_sessionSidebarWidth = ${sessionSidebarWidthDefault};
						@post('${endpoints.sessionSidebar}', { payload: { sessionSidebar: { width: ${sessionSidebarWidthDefault} } } });
					`}
				/>
				<div
					class="session-sidebar-scroller"
					data-on:scrollend={`if (el.scrollLeft < -1 && el.scrollWidth + el.scrollLeft <= el.clientWidth + 1) {
						el.closest('dialog').close();
					}`}
				>
					<nav
						class="raised-surface session-sidebar-nav"
						aria-label="Sessions"
						aria-keyshortcuts={keybindAria("focus-sessions")}
						tabindex="-1"
						autofocus
						data-on:keydown={`if (
							!evt.altKey &&
							!evt.ctrlKey &&
							!evt.metaKey &&
							!evt.shiftKey &&
							['ArrowDown', 'ArrowUp', 'KeyJ', 'KeyK'].includes(evt.code)
						) {
							const rows = [...el.querySelectorAll('li > button:not(:disabled)')].filter((row) =>
								row.checkVisibility(),
							);
							const current = rows.indexOf(document.activeElement);
							if (current >= 0) {
								evt.preventDefault();
								const direction = ['ArrowDown', 'KeyJ'].includes(evt.code) ? 1 : -1;
								const next = Math.max(0, Math.min(rows.length - 1, current + direction));
								rows[next]?.focus({ preventScroll: true });
								rows[next]?.scrollIntoView({ block: 'nearest' });
							}
						}`}
					>
						<header class="session-sidebar-header">
							<div class="session-sidebar-heading">
								<span>Sessions</span>
								<ShortcutKbd shortcut={activeKeybind("focus-sessions")} />
							</div>
						</header>
						<section id="session-sidebar-viewport">
							<div
								role="group"
								class="session-sidebar-group"
								aria-label="Recent sessions"
							>
								{renderSessionSidebarContent(state)}
							</div>
						</section>
					</nav>
				</div>
			</dialog>
			<script>{`{ const el = document.getElementById('session-sidebar'); ${restoreSessionSidebar(desktopOpen)} }`}</script>
		</>,
	);
}

/** Only row order and grouping can change the sidebar layout. */
export function sessionSidebarLayoutKey(state: SessionSidebarState): string {
	return JSON.stringify(
		groupSessionsByDate(state).map((group) => [
			group.key,
			Boolean(group.label),
			state.sessionSidebarArchive && group.archived,
			group.sessions.map(({ session }) => session.path),
		]),
	);
}

export function renderSessionSidebarContent(state: SessionSidebarState): string {
	const groups = groupSessionsByDate(state);
	const archiveGroups = state.sessionSidebarArchive
		? groups.filter((group) => group.archived)
		: [];
	const inlineGroups =
		archiveGroups.length > 0 ? groups.filter((group) => !group.archived) : groups;
	const pageTrigger = state.sessionsHasMore
		? renderSessionPageTrigger(`session-sidebar-page-${state.sessions.length}`)
		: undefined;
	const showArchive =
		state.sessionSidebarArchive &&
		(archiveGroups.length > 0 || state.sessionsHasMore);
	return syncHtml(
		<div id="session-sidebar-content">
			<ul id="session-sidebar-recent-list">
				{inlineGroups.map((group) => renderSessionDateGroup(group, state))}
			</ul>
			{showArchive && (
				<details id="session-sidebar-archive" data-preserve-attr="open">
					<summary class="session-group-heading">
						<span>Archive</span>
						<span class="session-group-rule" aria-hidden="true" />
						<Icon name="chevron-left" />
					</summary>
					<ul id="session-sidebar-archive-list">
						{archiveGroups.map((group) =>
							renderSessionDateGroup(group, state),
						)}
					</ul>
					{pageTrigger}
				</details>
			)}
			{!showArchive && pageTrigger}
			{state.sessionCatalogLoading && (
				<div class="session-sidebar-loading">{loaderIcon()}</div>
			)}
		</div>,
	);
}

function renderSessionDateGroup(group: SessionDateGroup, state: SessionSidebarState) {
	return (
		<>
			{group.label && (
				<li class="session-date-heading">
					<h3 id={`session-sidebar-${group.key}`} class="session-group-heading">
						<span>{group.label}</span>
						<span class="session-group-rule" aria-hidden="true" />
					</h3>
				</li>
			)}
			{group.sessions.map(({ session, index }) =>
				renderSessionSidebarRow(session, index, state, group.showRowDate),
			)}
		</>
	);
}

function sessionSidebarRowId(path: string): string {
	return `session-sidebar-row-${encodeURIComponent(path)}`;
}

export function renderSessionPageTrigger(id: string) {
	return (
		<div
			id={id}
			class="session-page-trigger"
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
	archived: boolean;
	sessions: Array<{ session: AppSessionSummary; index: number }>;
};

function groupSessionsByDate(
	state: SessionSidebarState,
	now = new Date(),
): SessionDateGroup[] {
	const archiveAfterDays = state.sessionSidebarArchiveAfterDays;
	const groups = new Map<string, SessionDateGroup>();
	for (const [index, session] of state.sessions.entries()) {
		const status = sessionStatus(session, state);
		const date = sessionDate(session.modifiedAt);
		const key = status ?? (date ? localDateKey(date) : "unknown");
		let group = groups.get(key);
		if (!group) {
			const difference = date ? calendarDayDifference(date, now) : undefined;
			group = {
				key,
				label: status
					? undefined
					: date && difference !== undefined
						? sessionGroupLabel(date, difference, now)
						: "Unknown date",
				archived:
					!status &&
					(difference === undefined || difference >= archiveAfterDays),
				showRowDate:
					Boolean(status) || difference === 0 || difference === undefined,
				sessions: [],
			};
			groups.set(key, group);
		}
		if (session.path === state.currentSessionPath) group.archived = false;
		group.sessions.push({ session, index });
	}
	return groups.values().toArray();
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
	return formatCalendarDay(date, now, systemTimeLocale);
}

function renderSessionSidebarRow(
	session: AppSessionSummary,
	index: number,
	state: SessionSidebarState,
	showDate: boolean,
): string {
	const current = session.path === state.currentSessionPath;
	const status = sessionStatus(session, state);
	const shortcut = index < 9 ? `ctrl ${index + 1}` : undefined;
	const deletable = status !== "running";
	return syncHtml(
		<li id={sessionSidebarRowId(session.path)} class="session-sidebar-row">
			<button
				type="button"
				class="session-sidebar-row-button"
				data-size="lg"
				data-active={current ? "true" : undefined}
				aria-current={current ? "true" : undefined}
				aria-label={session.title}
				data-attr:aria-disabled="$_sessionTransitionStatus === 'loading' ? 'true' : 'false'"
				data-on:click={resumeSessionAction(session.path)}
				data-on:keydown__window={
					shortcut
						? resumeSessionShortcutAction(session.path, index)
						: undefined
				}
			/>
			<span class="session-sidebar-row-content">
				<span class="session-sidebar-row-heading">
					<span
						class={[
							"session-status-transition",
							!status && "session-status-empty",
						]}
						aria-hidden={status ? undefined : "true"}
					>
						<StatusDot
							state={status === "running" ? "running" : "success"}
							label={status ? sessionStatusLabel(status, current) : ""}
						/>
					</span>
					{current ? (
						<SessionRenameTitle session={session} />
					) : (
						<span class="session-sidebar-title" safe>
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
				<span class="session-sidebar-row-meta">
					<SessionSubtitle
						session={session}
						class="fine-print session-sidebar-subtitle"
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
