import { endpoints } from "../server/routes/endpoints.ts";
import type { AppSessionSummary, AppStateSnapshot } from "../state/app-store.ts";
import { calendarDayDifference } from "../utils/date-time-format.ts";
import { primaryModifierExpression } from "../utils/keyboard.ts";
import { systemTimeLocale } from "../utils/locale.ts";
import { DateTime } from "./date-time.tsx";
import { altShortcutAction, ShortcutKbd } from "./keyboard.tsx";
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

const sidebarWidth = { min: 224, default: 288, max: 384 } as const;
const sidebarWidthCss =
	"clamp(var(--session-sidebar-min-width), ${$_sessionSidebarWidth}px, min(var(--session-sidebar-max-width), 50vw))";
export const sessionSidebarMarginRightExpression = `\`${sidebarWidthCss}\``;
export const sessionSidebarStorageKey = "pi-ui-session-sidebar-width";
const sidebarHandleRightExpression = `\`calc(${sidebarWidthCss} + var(--workspace-inset) - var(--workspace-gap))\``;
const sidebarNavWidthExpression = `\`calc(${sidebarWidthCss} - var(--workspace-gap))\``;
const sidebarPointerWidthExpression = `Math.round(Math.min(
	Math.max(${sidebarWidth.min}, Math.min(${sidebarWidth.max}, innerWidth * 0.5)),
	Math.max(${sidebarWidth.min}, $_sessionSidebarWidth + $_sessionSidebarPointerX - evt.clientX),
))`;
const sidebarResizeFinish = `document.documentElement.classList.remove('is-resizing');
localStorage.setItem('${sessionSidebarStorageKey}', String($_sessionSidebarWidth));`;
const focusSessionSidebarShortcut = altShortcutAction(
	"KeyS",
	`el.open?.();
	requestAnimationFrame(() => {
		const target = el.querySelector(
			'li > button[aria-current="true"], li > button[data-active="true"], li > button',
		) ?? el.querySelector('nav');
		target?.focus({ preventScroll: true });
	});`,
);

type SessionSidebarState = Pick<
	AppStateSnapshot,
	| "activityText"
	| "currentSessionPath"
	| "sessionCatalogLoading"
	| "sessions"
	| "sessionsHasMore"
>;

export function renderSessionSidebar(state: SessionSidebarState): string {
	return syncHtml(
		<aside
			id="session-sidebar"
			class="sidebar"
			data-side="right"
			data-initial-open={state.sessions.length === 0 && "false"}
			aria-keyshortcuts="Control+B Meta+B"
			data-signals:_session-sidebar-width__ifmissing={`
				Number(localStorage.getItem('${sessionSidebarStorageKey}')) ||
				${sidebarWidth.default}
			`}
			data-signals:_session-sidebar-pointer-x__ifmissing="0"
			data-signals:session-delete-hover__ifmissing="''"
			data-on:keydown__window={`if (evt.code === 'KeyB' && !evt.altKey && !evt.shiftKey && ${primaryModifierExpression()}) {
			evt.preventDefault();
			window.piUi.controls.toggleSidebar(el);
			}
			${focusSessionSidebarShortcut}`}
		>
			<div
				id="session-sidebar-separator"
				class="resize-handle session-sidebar-resize"
				aria-hidden="true"
				data-style:right={sidebarHandleRightExpression}
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
					$_sessionSidebarWidth = ${sidebarWidth.default};
					localStorage.setItem('${sessionSidebarStorageKey}', '${sidebarWidth.default}');
				`}
			/>
			<nav
				class="raised-surface session-sidebar-nav"
				aria-label="Sessions"
				aria-keyshortcuts="Alt+S"
				tabindex="-1"
				{...{
					"data-style:--session-sidebar-width": sidebarNavWidthExpression,
				}}
				data-on:keydown={`if (
					!evt.altKey &&
					!evt.ctrlKey &&
					!evt.metaKey &&
					!evt.shiftKey &&
					['ArrowDown', 'ArrowUp', 'KeyJ', 'KeyK'].includes(evt.code)
				) {
					const rows = [...el.querySelectorAll('li > button:not(:disabled)')];
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
						<ShortcutKbd shortcut="alt S" />
					</div>
				</header>
				<section>
					<div
						role="group"
						class="session-sidebar-group"
						aria-label="Recent sessions"
					>
						{renderSessionSidebarContent(state)}
					</div>
				</section>
			</nav>
		</aside>,
	);
}

export function renderSessionSidebarContent(state: SessionSidebarState): string {
	const sessions = state.sessions;
	const groups = groupSessionsByDate(sessions);
	return syncHtml(
		<div id="session-sidebar-content">
			{groups.map((group) => (
				<div>
					{group.label && (
						<h3
							id={`session-sidebar-${group.key}`}
							class="session-group-heading"
						>
							<span>{group.label}</span>
							<span class="session-group-rule" aria-hidden="true" />
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
				<div class="session-sidebar-loading">{loaderIcon()}</div>
			)}
			{state.sessionsHasMore && renderSessionPageTrigger()}
		</div>,
	);
}

function sessionSidebarRowId(path: string): string {
	return `session-sidebar-row-${encodeURIComponent(path)}`;
}

export function renderSessionPageTrigger() {
	return (
		<div
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
		<li id={sessionSidebarRowId(session.path)} class="session-sidebar-row">
			<button
				type="button"
				class="session-sidebar-row-button"
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
			/>
			<span class="session-sidebar-row-content">
				<span class="session-sidebar-row-heading">
					<span
						class={[
							"session-status-transition",
							!status && "session-status-empty",
						]}
					>
						{status && (
							<StatusDot
								class="session-sidebar-status"
								state={status === "running" ? "running" : "success"}
								label={sessionStatusLabel(status, current)}
							/>
						)}
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
