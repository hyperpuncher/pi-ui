import type { DelegateLedgerEntry } from "../agent/delegate-ledger-reader.ts";
import type { WorkflowJournalSummary } from "../agent/workflow-journal-reader.ts";
import {
	closeLiveWorkspaceAction,
	toggleLiveWorkspaceAction,
} from "../commands/actions.ts";
import {
	isPiUiSheetElement,
	type PiUiElement,
	piUiDialogId,
} from "../extension-surface-types.ts";
import { activeKeybind, keybindAction, keybindAria } from "../keybinds.ts";
import {
	formatRetryCountdown,
	liveWorkspaceRatioDefault,
	liveWorkspaceRatioMax,
	liveWorkspaceRatioMin,
	liveWorkspaceTabs,
	type LiveWorkspaceAgentRow,
	type LiveWorkspacePreferences,
	type LiveWorkspaceSnapshot,
	type LiveWorkspaceTab,
	type LiveWorkspaceTurnState,
} from "../live-workspace-types.ts";
import { endpoints } from "../server/routes/endpoints.ts";
import type { AppStateSnapshot, AppUsage } from "../state/app-store.ts";
import { formatTokens } from "../utils/format.ts";
import { Icon } from "./icon.tsx";
import {
	Activity,
	Bell,
	BellOff,
	Bot,
	Download,
	Gauge,
	List,
	Puzzle,
	X,
} from "./icons.ts";
import { ShortcutKbd, ShortcutTooltip } from "./keyboard.tsx";
import { renderPiUiElement } from "./pi-ui-elements.tsx";
import { resumeSessionAction } from "./session-transition.tsx";
import { syncHtml } from "./sync-html.ts";

/** Extension state the Extensions tab reads straight from AppStore (one source of truth). */
export type LiveWorkspaceExtensions = Pick<
	AppStateSnapshot,
	"extensionElements" | "extensionChannels"
>;

const noExtensions: LiveWorkspaceExtensions = {
	extensionElements: [],
	extensionChannels: [],
};

const tabLabels: Record<LiveWorkspaceTab, string> = {
	now: "Now",
	agents: "Agents",
	usage: "Usage",
	activity: "Activity",
	extensions: "Extensions",
};

const tabIcons: Record<LiveWorkspaceTab, typeof Activity> = {
	now: Activity,
	agents: Bot,
	usage: Gauge,
	activity: List,
	extensions: Puzzle,
};

/** Mirrors `workspace-review.tsx`'s resize-handle factory, scoped to the single `ratio` preference. */
function ratioResizeHandleAttributes() {
	const value = "$liveWorkspacePreferences.ratio";
	const normalize = `${value} = Math.min(
		${liveWorkspaceRatioMax},
		Math.max(${liveWorkspaceRatioMin}, ${value} || ${liveWorkspaceRatioDefault}),
	);`;
	const commit = `document.body.dispatchEvent(new CustomEvent(
		'pi-ui-live-workspace-preferences',
		{ detail: { ratio: ${value} } },
	));`;
	const finish = `if (el.hasPointerCapture(evt.pointerId)) {
		${normalize}
		document.documentElement.classList.remove('is-resizing');
		${commit}
	}`;
	// The handle sits left of the pane, so dragging it left (toward the chat) must widen the
	// pane: the ratio tracks how far the pointer moved back toward the right edge of the shell.
	const scale =
		"Math.max(1, document.getElementById('workspace-shell').clientWidth - 12)";
	return {
		"data-on:pointerdown": `if (evt.button === 0) {
			el.dataset.resizePointer = evt.clientX;
			el.dataset.resizeStart = ${value} || ${liveWorkspaceRatioDefault};
			el.setPointerCapture(evt.pointerId);
			document.documentElement.classList.add('is-resizing');
		}`,
		"data-on:pointermove__throttle.8ms": `if (el.hasPointerCapture(evt.pointerId)) {
			${value} = Number(el.dataset.resizeStart) -
				(evt.clientX - Number(el.dataset.resizePointer)) / (${scale});
		}`,
		"data-on:pointerup": finish,
		"data-on:pointercancel": finish,
		"data-on:dblclick": `${value} = ${liveWorkspaceRatioDefault}; ${commit}`,
		"data-on:keydown": `if (evt.code === 'ArrowLeft' || evt.code === 'ArrowRight') {
			evt.preventDefault();
			const direction = evt.code === 'ArrowLeft' ? 1 : -1;
			${value} = (${value} || ${liveWorkspaceRatioDefault}) +
				direction * (evt.shiftKey ? 0.08 : 0.02);
			${normalize}
			${commit}
		}`,
	};
}

/** The toolbar button that opens/closes the pane; rendered in `page.tsx`'s toolbar-end column. */
export function renderLiveWorkspaceToggle(_state: AppStateSnapshot): string {
	return syncHtml(
		<button
			id="live-workspace-toggle"
			type="button"
			class="btn live-workspace-toggle"
			data-variant="ghost"
			data-attr:data-variant="$_liveWorkspaceOpen ? 'secondary' : 'ghost'"
			data-size="icon-sm"
			aria-label="Toggle Live Workspace"
			aria-pressed="false"
			data-attr:aria-pressed="$_liveWorkspaceOpen ? 'true' : 'false'"
			aria-keyshortcuts={keybindAria("toggle-live-workspace")}
			data-on:click={toggleLiveWorkspaceAction()}
			data-on:keydown__window={keybindAction(
				"toggle-live-workspace",
				toggleLiveWorkspaceAction(),
			)}
			data-tooltip="Toggle Live Workspace"
			data-tooltip-delay
			data-align="end"
		>
			<Icon icon={Activity} />
			<ShortcutTooltip
				label="Toggle Live Workspace"
				shortcut={activeKeybind("toggle-live-workspace")}
			/>
		</button>,
	);
}

/** The pane shell, mounted once in `page.tsx` alongside `#workspace-review`. */
export function renderLiveWorkspace(
	snapshot: LiveWorkspaceSnapshot,
	preferences: LiveWorkspacePreferences,
	usage: AppUsage,
	extensions: LiveWorkspaceExtensions = noExtensions,
): string {
	return syncHtml(
		<>
			<div
				id="live-workspace-backdrop"
				aria-hidden="true"
				hidden
				data-attr:hidden="!$_liveWorkspaceOpen"
				data-on:click={closeLiveWorkspaceAction()}
			/>
			<section
				id="live-workspace"
				aria-label="Live Workspace"
				aria-keyshortcuts={keybindAria("toggle-live-workspace")}
				aria-hidden="true"
				inert
				data-attr:aria-hidden="$_liveWorkspaceOpen ? 'false' : 'true'"
				data-attr:inert="!$_liveWorkspaceOpen"
				data-on:keydown={`if (evt.code === 'Escape') { ${closeLiveWorkspaceAction()} }`}
			>
				<div
					id="live-workspace-separator"
					class="resize-handle"
					role="separator"
					tabindex="0"
					aria-label="Resize Live Workspace"
					aria-orientation="vertical"
					aria-valuemin={liveWorkspaceRatioMin * 100}
					aria-valuemax={liveWorkspaceRatioMax * 100}
					data-attr:aria-valuenow={`Math.round(($liveWorkspacePreferences.ratio || ${liveWorkspaceRatioDefault}) * 100)`}
					attrs={ratioResizeHandleAttributes()}
				/>
				<div
					id="live-workspace-drag-handle"
					class="live-workspace-drag-handle"
					aria-hidden="true"
				/>
				<header class="live-workspace-header">
					<div
						class="segmented-control live-workspace-tabs"
						aria-label="Live Workspace tabs"
					>
						{liveWorkspaceTabs.map((tab) => (
							<button
								type="button"
								class="live-workspace-tab-button"
								aria-pressed={tab === "now" ? "true" : "false"}
								aria-label={tabLabels[tab]}
								data-tooltip={tabLabels[tab]}
								data-tooltip-delay
								data-attr:aria-pressed={`$liveWorkspacePreferences.tab === '${tab}' || (!$liveWorkspacePreferences.tab && '${tab}' === 'now') ? 'true' : 'false'`}
								data-on:click={`
								el.focus();
								$liveWorkspacePreferences.tab = '${tab}';
								document.body.dispatchEvent(new CustomEvent(
									'pi-ui-live-workspace-preferences',
									{ detail: { tab: '${tab}' } },
								));
							`}
							>
								<Icon icon={tabIcons[tab]} />
								{/* A#26: the label stays for assistive tech and the tooltip, but visually
							    the tabs are icon-only so 5 of them never wrap at the drawer's 26rem width. */}
								<span class="sr-only">{tabLabels[tab]}</span>
								<ShortcutTooltip label={tabLabels[tab]} />
							</button>
						))}
					</div>
					<div class="live-workspace-header-actions">
						<button
							type="button"
							id="live-workspace-notifications-toggle"
							class="btn"
							data-variant="ghost"
							data-attr:data-variant="$liveWorkspacePreferences.notifications ? 'secondary' : 'ghost'"
							data-size="icon-xs"
							aria-pressed="false"
							data-attr:aria-pressed="$liveWorkspacePreferences.notifications ? 'true' : 'false'"
							aria-label="Notify me when a turn finishes or needs input"
							data-tooltip="Notify on completion"
							data-tooltip-delay
							data-on:click={`
							$liveWorkspacePreferences.notifications = !$liveWorkspacePreferences.notifications;
							document.body.dispatchEvent(new CustomEvent(
								'pi-ui-live-workspace-preferences',
								{ detail: { notifications: $liveWorkspacePreferences.notifications } },
							));
							if ($liveWorkspacePreferences.notifications) {
								window.piUi.liveWorkspace.requestNotificationPermission();
							}
						`}
						>
							<span
								class="live-workspace-icon-state"
								style={
									preferences.notifications
										? undefined
										: "display: none"
								}
								data-show="$liveWorkspacePreferences.notifications"
							>
								<Icon icon={Bell} />
							</span>
							<span
								class="live-workspace-icon-state"
								style={
									preferences.notifications
										? "display: none"
										: undefined
								}
								data-show="!$liveWorkspacePreferences.notifications"
							>
								<Icon icon={BellOff} />
							</span>
							<ShortcutTooltip label="Notify on completion" />
						</button>
						<button
							type="button"
							class="btn live-workspace-close"
							data-variant="ghost"
							data-size="icon-xs"
							data-on:click={closeLiveWorkspaceAction()}
							aria-label="Hide Live Workspace"
						>
							<Icon icon={X} />
							<ShortcutKbd
								shortcut={activeKeybind("toggle-live-workspace")}
							/>
						</button>
					</div>
				</header>
				<div class="live-workspace-body raised-surface">
					{renderLiveWorkspaceData(snapshot, preferences, usage, extensions)}
				</div>
			</section>
		</>,
	);
}

/**
 * The patchable data region, split into one standalone fragment per tab (each keeps the
 * `id` it always had) so `UiRenderer` can patch only the tab(s) whose underlying state
 * actually changed instead of re-rendering and re-sending all five on every Live Workspace
 * commit (round-2 audit A#13) — active tools, agents and activity change far more often
 * than usage or the extensions roster. `renderLiveWorkspaceData` composes all five for a
 * fresh `/stream` connection, where the whole pane is sent at once regardless.
 */
export function renderLiveWorkspaceNowSection(
	snapshot: LiveWorkspaceSnapshot,
	tab: LiveWorkspaceTab,
): string {
	return syncHtml(
		<section
			id="live-workspace-now"
			aria-label="Now"
			data-show="($liveWorkspacePreferences.tab || 'now') === 'now'"
			style={tab === "now" ? undefined : "display: none"}
		>
			{renderNowTab(snapshot)}
		</section>,
	);
}
export function renderLiveWorkspaceAgentsSection(
	snapshot: LiveWorkspaceSnapshot,
	tab: LiveWorkspaceTab,
): string {
	return syncHtml(
		<section
			id="live-workspace-agents"
			aria-label="Agents"
			data-show="$liveWorkspacePreferences.tab === 'agents'"
			style={tab === "agents" ? undefined : "display: none"}
		>
			{renderAgentsTab(snapshot)}
		</section>,
	);
}
export function renderLiveWorkspaceUsageSection(
	usage: AppUsage,
	tab: LiveWorkspaceTab,
): string {
	return syncHtml(
		<section
			id="live-workspace-usage"
			aria-label="Usage"
			data-show="$liveWorkspacePreferences.tab === 'usage'"
			style={tab === "usage" ? undefined : "display: none"}
		>
			{renderUsageTab(usage)}
		</section>,
	);
}
export function renderLiveWorkspaceActivitySection(
	snapshot: LiveWorkspaceSnapshot,
	tab: LiveWorkspaceTab,
): string {
	return syncHtml(
		<section
			id="live-workspace-activity"
			aria-label="Activity"
			data-show="$liveWorkspacePreferences.tab === 'activity'"
			style={tab === "activity" ? undefined : "display: none"}
		>
			{renderActivityTab(snapshot)}
		</section>,
	);
}
export function renderLiveWorkspaceExtensionsSection(
	extensions: LiveWorkspaceExtensions,
	tab: LiveWorkspaceTab,
): string {
	return syncHtml(
		<section
			id="live-workspace-extensions"
			aria-label="Extensions"
			data-show="$liveWorkspacePreferences.tab === 'extensions'"
			style={tab === "extensions" ? undefined : "display: none"}
		>
			{renderExtensionsTab(extensions)}
		</section>,
	);
}

/** All five tabs, composed for a fresh `/stream` connection's one-time full render. */
export function renderLiveWorkspaceData(
	snapshot: LiveWorkspaceSnapshot,
	preferences: LiveWorkspacePreferences,
	usage: AppUsage,
	extensions: LiveWorkspaceExtensions = noExtensions,
): string {
	const tab = preferences.tab ?? "now";
	return (
		renderLiveWorkspaceNowSection(snapshot, tab) +
		renderLiveWorkspaceAgentsSection(snapshot, tab) +
		renderLiveWorkspaceUsageSection(usage, tab) +
		renderLiveWorkspaceActivitySection(snapshot, tab) +
		renderLiveWorkspaceExtensionsSection(extensions, tab)
	);
}

function renderNowTab(snapshot: LiveWorkspaceSnapshot): string {
	return syncHtml(
		<div class="live-workspace-panel">
			{renderTurnBanner(snapshot.turn)}
			{(snapshot.queuedSteering > 0 || snapshot.queuedFollowUp > 0) && (
				<p class="fine-print live-workspace-queue-note">
					{snapshot.queuedSteering > 0 && (
						<span>
							{snapshot.queuedSteering} queued steering message
							{snapshot.queuedSteering === 1 ? "" : "s"}
						</span>
					)}
					{snapshot.queuedSteering > 0 && snapshot.queuedFollowUp > 0 && " · "}
					{snapshot.queuedFollowUp > 0 && (
						<span>
							{snapshot.queuedFollowUp} queued follow-up
							{snapshot.queuedFollowUp === 1 ? "" : "s"}
						</span>
					)}
				</p>
			)}
			<h3 class="live-workspace-section-heading">Active tools</h3>
			{snapshot.activeTools.length === 0 ? (
				<p class="fine-print live-workspace-empty">No tools running.</p>
			) : (
				<ul class="live-workspace-tool-list">
					{snapshot.activeTools.map((tool) => (
						<li class="live-workspace-tool-row">
							<span class="live-workspace-tool-name" safe>
								{tool.summary ?? tool.toolName}
							</span>
							<span
								class="fine-print live-workspace-tool-elapsed"
								data-live-workspace-elapsed={tool.startedAt}
							/>
							{tool.preview && (
								<pre class="live-workspace-tool-preview" safe>
									{tool.preview}
								</pre>
							)}
						</li>
					))}
				</ul>
			)}
		</div>,
	);
}

function renderTurnBanner(turn: LiveWorkspaceTurnState | undefined): string {
	if (!turn) {
		return syncHtml(
			<p class="fine-print live-workspace-empty">No turn in progress.</p>,
		);
	}
	const canAbort = turn.phase === "running" || turn.phase === "retrying";
	return syncHtml(
		<div class="live-workspace-turn-banner" data-turn-phase={turn.phase}>
			<span class="live-workspace-turn-text">
				<span class="live-workspace-turn-label" safe>
					{turnLabelPrefix(turn)}
				</span>
				{turn.phase === "retrying" && turn.retryAt !== undefined && (
					<span
						class="fine-print live-workspace-turn-countdown"
						data-live-workspace-retry-at={turn.retryAt}
					>
						{formatRetryCountdown(Math.max(0, turn.retryAt - Date.now()))}
					</span>
				)}
			</span>
			{canAbort && (
				<button
					type="button"
					class="btn"
					data-variant="outline"
					data-size="xs"
					data-on:click={`@post('${endpoints.abort}', { payload: {} })`}
				>
					Abort
				</button>
			)}
		</div>,
	);
}

/** The phase label, minus the retry countdown (that part is client-ticked; A#26). */
function turnLabelPrefix(turn: LiveWorkspaceTurnState): string {
	if (turn.phase === "waiting-for-extension") {
		return `Waiting for extension UI${turn.waitingTitle ? `: ${turn.waitingTitle}` : ` (${turn.waitingKind})`}`;
	}
	if (turn.phase === "compacting") {
		return `Compacting context (${turn.compactionReason})`;
	}
	if (turn.phase === "retrying") {
		const attempts =
			turn.retryAttempt !== undefined && turn.retryMaxAttempts !== undefined
				? ` ${turn.retryAttempt}/${turn.retryMaxAttempts}`
				: "";
		return `Retrying${attempts}`;
	}
	return "Running";
}

function renderAgentsTab(snapshot: LiveWorkspaceSnapshot): string {
	return syncHtml(
		<div class="live-workspace-panel">
			{/* Read-only views onto other extensions' own on-disk state (R2-C): the `workflows`
			    extension's run journal and the `pi-herdr-delegate` ledger. Loaded on demand
			    rather than polled, since both are read from disk on every request. */}
			<div class="live-workspace-agents-extra-actions">
				<button
					type="button"
					class="btn"
					data-variant="outline"
					data-size="xs"
					data-on:click={`@get('${endpoints.liveWorkspaceWorkflowJournal}', { payload: {} })`}
				>
					Workflow status
				</button>
				<button
					type="button"
					class="btn"
					data-variant="outline"
					data-size="xs"
					data-on:click={`@get('${endpoints.liveWorkspaceDelegateLedger}', { payload: {} })`}
				>
					Delegations
				</button>
			</div>
			<div
				id="live-workspace-workflow-journal"
				class="live-workspace-extra-panel"
			/>
			<div id="live-workspace-delegate-ledger" class="live-workspace-extra-panel" />
			{snapshot.agents.length === 0 ? (
				<p class="fine-print live-workspace-empty">
					No subagents, background jobs, or background sessions.
				</p>
			) : (
				<ul class="live-workspace-agent-list">
					{snapshot.agents.map((agent) => renderAgentRow(agent))}
				</ul>
			)}
		</div>,
	);
}

/** Patched into `#live-workspace-workflow-journal` on demand (Agents tab, "Workflow status"). */
export function renderWorkflowJournalPanel(
	summary: WorkflowJournalSummary | undefined,
): string {
	return syncHtml(
		<div id="live-workspace-workflow-journal" class="live-workspace-extra-panel">
			{summary ? (
				<div class="live-workspace-panel">
					<h3 class="live-workspace-section-heading" safe>
						{summary.workflowName}
					</h3>
					<p class="fine-print" safe>
						{summary.status}
						{summary.phases.length > 0
							? ` · ${summary.phases.join(" → ")}`
							: ""}
					</p>
					{summary.agents.length > 0 && (
						<ul class="live-workspace-agent-list">
							{summary.agents.map((agent) => (
								<li class="live-workspace-agent-row">
									<span class="live-workspace-agent-label" safe>
										{agent.label}
									</span>
									<span
										class="fine-print live-workspace-agent-status"
										safe
									>
										{agent.status}
										{agent.model ? ` · ${agent.model}` : ""}
										{agent.error ? ` · ${agent.error}` : ""}
									</span>
									{agent.tokens !== undefined && (
										<span class="fine-print live-workspace-agent-tokens">
											{formatTokens(agent.tokens)} tok
										</span>
									)}
								</li>
							))}
						</ul>
					)}
				</div>
			) : (
				<p class="fine-print live-workspace-empty">
					No workflow run found for this workspace.
				</p>
			)}
		</div>,
	);
}

/** Patched into `#live-workspace-delegate-ledger` on demand (Agents tab, "Delegations"). */
export function renderDelegateLedgerPanel(
	entries: readonly DelegateLedgerEntry[],
): string {
	return syncHtml(
		<div id="live-workspace-delegate-ledger" class="live-workspace-extra-panel">
			{entries.length > 0 ? (
				<ul class="live-workspace-agent-list">
					{entries.map((entry) => (
						<li class="live-workspace-agent-row">
							<span class="live-workspace-agent-label" safe>
								{entry.childName ?? entry.prompt}
							</span>
							<span class="fine-print live-workspace-agent-status" safe>
								{entry.status}
								{entry.model ? ` · ${entry.model}` : ""}
							</span>
							<span
								class="fine-print live-workspace-agent-tokens"
								data-live-workspace-elapsed={entry.delegatedAt}
							/>
						</li>
					))}
				</ul>
			) : (
				<p class="fine-print live-workspace-empty">No delegations recorded.</p>
			)}
		</div>,
	);
}

function renderAgentRow(agent: LiveWorkspaceAgentRow): string {
	return syncHtml(
		<li
			class="live-workspace-agent-row"
			style={agent.depth > 0 ? `padding-left: ${agent.depth}rem` : undefined}
		>
			<span class="live-workspace-agent-label" safe>
				{agent.label}
			</span>
			<span class="fine-print live-workspace-agent-status" safe>
				{agent.status}
				{agent.detail ? ` · ${agent.detail}` : ""}
			</span>
			{agent.tokens !== undefined && (
				<span class="fine-print live-workspace-agent-tokens">
					{formatTokens(agent.tokens)} tok
				</span>
			)}
			{agent.activeToolCount !== undefined && agent.activeToolCount > 0 && (
				<span class="fine-print live-workspace-agent-tools">
					{agent.activeToolCount} tool{agent.activeToolCount === 1 ? "" : "s"}{" "}
					running
				</span>
			)}
			{agent.kind === "background-session" && (
				<button
					type="button"
					class="btn"
					data-variant="outline"
					data-size="xs"
					data-on:click={resumeSessionAction(agent.id)}
				>
					Open
				</button>
			)}
		</li>,
	);
}

/** No turn has streamed anything to spend on yet (the store's zero-usage default). */
function isUsageEmpty(usage: AppUsage): boolean {
	return (
		usage.contextTokens === undefined &&
		usage.cacheHitPercent === undefined &&
		!usage.limits &&
		usage.text === "$0.000 • 0 tokens"
	);
}

function renderUsageTab(usage: AppUsage): string {
	if (isUsageEmpty(usage)) {
		return syncHtml(
			<p class="fine-print live-workspace-empty">
				No usage recorded yet. Token and cost totals appear once a turn runs.
			</p>,
		);
	}
	const contextPercent = usage.contextPercent ?? 0;
	return syncHtml(
		<div class="live-workspace-panel">
			<dl class="live-workspace-usage-grid">
				<div>
					<dt>Session</dt>
					<dd safe>{usage.text}</dd>
				</div>
				<div>
					<dt>Cost</dt>
					<dd safe>{usage.costText}</dd>
				</div>
				{usage.cacheHitPercent !== undefined && (
					<div>
						<dt>Cache hit</dt>
						<dd>{Math.round(usage.cacheHitPercent)}%</dd>
					</div>
				)}
			</dl>
			{usage.contextTokens !== undefined && usage.contextWindow !== undefined && (
				<div class="live-workspace-context-meter">
					<div class="fine-print">
						Context: {formatTokens(usage.contextTokens)} /{" "}
						{formatTokens(usage.contextWindow)} ({Math.round(contextPercent)}
						%)
					</div>
					<div
						class="live-workspace-meter-track"
						role="meter"
						aria-valuemin={0}
						aria-valuemax={100}
						aria-valuenow={Math.round(contextPercent)}
					>
						<div
							class="live-workspace-meter-fill"
							style={`width: ${Math.min(100, Math.max(0, contextPercent))}%`}
						/>
					</div>
				</div>
			)}
			{usage.limits && usage.limits.windows.length > 0 && (
				<div class="live-workspace-limits">
					<h3 class="live-workspace-section-heading" safe>
						{usage.limits.label}
					</h3>
					<ul class="live-workspace-limits-list">
						{usage.limits.windows.map((window) => (
							<li>
								<span safe>{window.label}</span>
								<span class="fine-print" safe>
									{Math.round(window.usedPercent)}% used · resets{" "}
									{window.resetText}
								</span>
							</li>
						))}
					</ul>
				</div>
			)}
		</div>,
	);
}

function renderActivityTab(snapshot: LiveWorkspaceSnapshot): string {
	return syncHtml(
		<div class="live-workspace-panel">
			<div class="live-workspace-activity-header">
				<span class="fine-print">{snapshot.activity.length} events</span>
				<div class="live-workspace-activity-header-actions">
					<a
						class="btn"
						data-variant="ghost"
						data-size="icon-xs"
						href={endpoints.liveWorkspaceActivityExport}
						download=""
						aria-disabled={
							snapshot.activity.length === 0 ? "true" : undefined
						}
						aria-label="Export activity log as JSON"
						data-tooltip="Export as JSON"
						data-tooltip-delay
					>
						<Icon icon={Download} />
						<ShortcutTooltip label="Export as JSON" />
					</a>
					<button
						type="button"
						class="btn"
						data-variant="ghost"
						data-size="xs"
						data-on:click={`@post('${endpoints.liveWorkspaceClearActivity}', { payload: {} })`}
						disabled={snapshot.activity.length === 0}
					>
						Clear
					</button>
				</div>
			</div>
			{snapshot.activity.length === 0 ? (
				<p class="fine-print live-workspace-empty">No activity recorded yet.</p>
			) : (
				<ul class="live-workspace-activity-list">
					{snapshot.activity.map((entry) => (
						<li
							class="live-workspace-activity-row"
							data-activity-kind={entry.kind}
							data-background={entry.background || undefined}
						>
							<span class="live-workspace-activity-text" safe>
								{entry.text}
							</span>
							<span
								class="fine-print live-workspace-activity-time"
								data-live-workspace-elapsed={entry.at}
							/>
						</li>
					))}
				</ul>
			)}
		</div>,
	);
}

function renderExtensionsTab(extensions: LiveWorkspaceExtensions): string {
	const elements = extensions.extensionElements.filter(
		(element) => element.kind !== "composer",
	);
	const inline = elements.filter((element) => !isPiUiSheetElement(element));
	const sheets = elements.filter(isPiUiSheetElement);
	const channels = extensions.extensionChannels;
	if (elements.length === 0 && channels.length === 0) {
		return syncHtml(
			<p class="fine-print live-workspace-empty">
				No extension UI or channel activity observed yet.
			</p>,
		);
	}
	return syncHtml(
		<div class="live-workspace-panel">
			{inline.length > 0 && (
				<>
					<h3 class="live-workspace-section-heading">Extension UI</h3>
					<div class="piui-widgets live-workspace-piui-elements">
						{inline.map((element) => renderPiUiElement(element))}
					</div>
				</>
			)}
			{sheets.length > 0 && (
				<>
					<h3 class="live-workspace-section-heading">Extension panels</h3>
					<ul class="live-workspace-channel-list">
						{sheets.map((element) => renderSheetRow(element))}
					</ul>
				</>
			)}
			{channels.length > 0 && (
				<>
					<h3 class="live-workspace-section-heading">Channels</h3>
					<ul class="live-workspace-channel-list">
						{channels.map((channel) => (
							<li class="live-workspace-channel-row">
								<header>
									<span class="live-workspace-channel-name" safe>
										{channel.channel}
									</span>
									<span
										class="fine-print live-workspace-activity-time"
										data-live-workspace-elapsed={channel.updatedAt}
									/>
								</header>
								<pre class="live-workspace-channel-payload" safe>
									{JSON.stringify(channel.payload, null, 2)}
								</pre>
							</li>
						))}
					</ul>
				</>
			)}
		</div>,
	);
}

/**
 * Sheet elements already own a `<dialog>` (see pi-ui-elements.tsx); this row reopens it. A
 * plain `commandfor`/`command="show-modal"` invoker triggers the browser's own (unguarded)
 * open handling, which logs "A command attempted to open an already open Dialog as a modal"
 * when the extension re-shows the same sheet (or the user re-opens it from here) while it's
 * already open (F3) — guard it the same way every other programmatic `showModal()` call in
 * this codebase does (see `ui-renderer.ts`'s reopen scripts).
 */
function renderSheetRow(element: PiUiElement): string {
	const dialogId = piUiDialogId(element);
	return syncHtml(
		<li class="live-workspace-agent-row">
			<span class="live-workspace-agent-label" safe>
				{element.title ?? element.id}
			</span>
			<span class="fine-print live-workspace-agent-status" safe>
				{element.ns}
			</span>
			<button
				type="button"
				class="btn"
				data-variant="outline"
				data-size="xs"
				data-on:click={`{ const dialog = document.getElementById(${JSON.stringify(dialogId)}); if (dialog && !dialog.open) dialog.showModal(); }`}
			>
				Open
			</button>
		</li>,
	);
}
