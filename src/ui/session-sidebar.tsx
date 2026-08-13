import type { AppRenderSnapshot, AppSessionSummary } from "../state/app-store.ts";
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
				style="right: calc(18rem + var(--pi-workspace-inset) - var(--pi-workspace-gap));"
				role="separator"
				tabindex="0"
				aria-label="Resize sessions and chat"
				aria-orientation="vertical"
				aria-valuemin="224"
				aria-valuemax="480"
				aria-valuenow="288"
			></div>
			<nav
				class="pi-raised-surface inset-y-(--pi-workspace-inset)! right-(--pi-workspace-inset)! w-[calc(var(--sidebar-mobile-width)-var(--pi-workspace-gap))] transition-transform duration-150 ease-[cubic-bezier(0.23,1,0.32,1)] motion-reduce:transition-none md:w-[calc(var(--sidebar-width)-var(--pi-workspace-gap))]"
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

export function renderSessionSidebarContent(state: SessionSidebarState): string {
	return (
		<ul id="session-sidebar-content">
			{state.sessions.map((session, index) =>
				renderSessionSidebarRow(session, index, state),
			)}
			{state.sessionCatalogLoading ? (
				<li class="flex justify-center px-2 py-4 text-muted-foreground">
					{loaderIcon()}
				</li>
			) : state.sessions.length === 0 ? (
				<li class="px-2 py-4 text-xs text-muted-foreground">No sessions yet.</li>
			) : undefined}
		</ul>
	) as string;
}

function renderSessionSidebarRow(
	session: AppSessionSummary,
	index: number,
	state: SessionSidebarState,
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
					<DateTime dateTime={session.modifiedAt} label={session.modified} />
				</span>
				<span class="flex h-6 min-w-0 items-center gap-2">
					<SessionSubtitle
						session={session}
						class="pi-fine-print min-w-0 flex-1 overflow-hidden text-[10px]"
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
