import type {
	AppExtensionWorkingIndicator,
	AppUsage,
	AppUsageLimits,
} from "../state/app-store.ts";
import type { AppStateSnapshot } from "../state/app-store.ts";
import { formatTokens } from "../utils/format.ts";
import { Icon } from "./icon.tsx";
import { Loader } from "./icons.ts";
import { renderPiUiStatusChips } from "./pi-ui-elements.tsx";
import { StatusDot } from "./status-dot.tsx";
import { syncHtml } from "./sync-html.ts";

// Pure-CSS frame counts the working-indicator animation ships keyframes for
// (see prompt-status.css). Extensions rarely animate more than a handful of
// glyphs (spinners/braille dots); anything wider falls back to a static
// first frame rather than growing the stylesheet for an unbounded count.
const animatedFrameCounts = new Set([2, 3, 4, 5, 6, 7, 8, 9, 10]);

export function renderPromptStatus(state: AppStateSnapshot): string {
	const activityText = state.extensionWorkingMessage ?? state.activityText;
	// The turn phase (from raw session/extension-hook events — see `LiveWorkspaceController`'s
	// `recordUiPromptStart`/`recordUiPromptEnd`, also used by the Live Workspace "Now" tab's
	// turn banner) already distinguishes an extension dialog or inline `custom()` waiting on
	// the user from an ordinary running turn; "Sending..." staying up through that wait reads
	// as a hang rather than a prompt for input (round-2 audit m6).
	const turn = state.liveWorkspace.turn;
	const waitingForExtension = turn?.phase === "waiting-for-extension";
	const sendingLabel = waitingForExtension
		? turn?.waitingTitle
			? `Waiting for extension input: ${turn.waitingTitle}`
			: "Waiting for extension input"
		: "Sending...";
	return syncHtml(
		<span id="prompt-status" class="prompt-status">
			<span
				class="prompt-status-message"
				data-show={waitingForExtension ? "true" : "$_promptSubmitting"}
				style="display: none"
			>
				{loaderIcon()}
				<span safe>{sendingLabel}</span>
			</span>
			{state.extensionWorkingVisible && activityText && (
				<span class="prompt-working-status">
					<span class="prompt-working-content">
						{renderWorkingIndicator(state.extensionWorkingIndicator)}
						<span safe>{activityText}</span>
					</span>
				</span>
			)}
			{state.extensionStatuses.map((status) => (
				<span class="extension-status" data-extension-status={status.key} safe>
					{status.text}
				</span>
			))}
			{renderPiUiStatusChips(state)}
			{/* extension-keys.js flashes `hidden` client-side; a status re-render
			    (e.g. the notice the consumed key triggers) must not reset it. */}
			<span
				class="extension-capture-indicator badge"
				id="extension-capture-indicator"
				data-ignore-morph
				data-variant="secondary"
				data-tooltip="An extension is listening for the next keystroke"
				hidden
			>
				<StatusDot
					state="running"
					label="Listening"
					class="extension-capture-dot"
				/>
				Listening
			</span>
			{renderUsageIndicators(state.usage)}
			{renderExtensionShortcutsData(state)}
		</span>,
	);
}

/**
 * Hidden data island (F1 §1/§2): every currently-registered `pi.registerShortcut()`
 * key, plus whether any `ctx.ui.onTerminalInput` listener is active outside a
 * focused terminal surface. `static/app/extension-keys.ts` re-reads this DOM
 * on every keydown rather than caching it, so it never needs its own
 * SSE/signal plumbing and always reflects the latest `AppStore.commit()` —
 * see `renderAppElements`'s doc comment on why this cheap a region doesn't
 * need its own dirty flag.
 */
function renderExtensionShortcutsData(state: AppStateSnapshot) {
	return (
		<span
			id="extension-shortcuts-data"
			data-terminal-input-active={state.extensionTerminalInputActive}
			hidden
		>
			{state.extensionShortcuts.map((shortcut) => (
				<span
					data-key={shortcut.key}
					data-description={shortcut.description ?? ""}
					data-extension={shortcut.extensionPath}
					data-reachable={shortcut.reachableByKeyboard}
				/>
			))}
		</span>
	);
}

export function renderUsageIndicators(usage: AppUsage): string {
	const contextPercent = usage.contextPercent ?? 0;
	const limitPercent =
		usage.limits?.windows.reduce(
			(maximum, window) => Math.max(maximum, window.usedPercent),
			0,
		) ?? 0;
	return syncHtml(
		<span class="usage-indicators">
			<button
				type="button"
				class="usage-indicator"
				data-tooltip="Context usage"
				data-on:click="el.focus()"
				aria-label={usage.text}
			>
				{usageRing(contextPercent, usageColor(contextPercent))}
				{renderContextTooltip(usage)}
			</button>
			{usage.limits && (
				<button
					type="button"
					class="usage-indicator"
					data-tooltip={usage.limits.label}
					data-on:click="el.focus()"
					aria-label={formatLimitsAriaLabel(usage.limits)}
				>
					{usageRing(limitPercent, usageColor(limitPercent))}
					{renderLimitsTooltip(usage.limits)}
				</button>
			)}
		</span>,
	);
}

function renderContextTooltip(usage: AppUsage): string {
	const { contextPercent, contextTokens, contextWindow } = usage;
	const hasContext =
		contextPercent !== undefined &&
		contextTokens !== undefined &&
		contextWindow !== undefined;

	return syncHtml(
		<span
			role="tooltip"
			data-slot="tooltip-content"
			popover="manual"
			class="usage-tooltip usage-tooltip-context"
		>
			{hasContext ? (
				<>
					<span class="usage-tooltip-heading">
						<strong class="usage-tooltip-title">Context usage</strong>
						<strong class="usage-tooltip-title">
							{Math.round(contextPercent)}% used
						</strong>
					</span>
					<span class="usage-tooltip-row">
						<strong>{formatTokens(contextTokens)} tokens</strong>
						<span class="inverse-fine-print">
							of {formatTokens(contextWindow)}
						</span>
					</span>
					<span class="usage-meter">
						<span
							class="usage-meter-value"
							style={`width: ${clampPercent(contextPercent)}%`}
						/>
					</span>
					<span class="inverse-fine-print usage-tooltip-footer">
						<span>
							{usage.cacheHitPercent === undefined
								? "cache hit unavailable"
								: `${usage.cacheHitPercent.toFixed(1)}% cache hit`}
						</span>
						<span>{usage.costText} session</span>
					</span>
				</>
			) : (
				<>
					<span class="usage-tooltip-row">
						<strong class="usage-tooltip-title">Context usage</strong>
						<span class="inverse-fine-print usage-tooltip-small">
							{usage.costText} session
						</span>
					</span>
					<span class="inverse-fine-print usage-tooltip-note">
						Available after next response
					</span>
				</>
			)}
		</span>,
	);
}

function renderLimitsTooltip(limits: AppUsageLimits): string {
	return syncHtml(
		<span
			role="tooltip"
			data-slot="tooltip-content"
			popover="manual"
			class="usage-tooltip usage-tooltip-limits"
		>
			<strong class="usage-tooltip-label">{limits.label}</strong>
			{limits.status && (
				<span class="inverse-fine-print usage-tooltip-note">{limits.status}</span>
			)}
			{limits.windows.map((window, index) => (
				<span
					class={
						index === 0 ? "usage-window" : "usage-window usage-window-spaced"
					}
				>
					<span class="usage-window-heading">
						<strong>{window.label}</strong>
						<strong>{window.remainingPercent}% left</strong>
					</span>
					<span class="usage-meter">
						<span
							class="usage-meter-value"
							style={`width: ${clampPercent(window.remainingPercent)}%`}
						/>
					</span>
					<span class="inverse-fine-print usage-window-reset">
						{window.resetText === "?"
							? "reset time unavailable"
							: `resets in ${window.resetText}`}
					</span>
				</span>
			))}
		</span>,
	);
}

function formatLimitsAriaLabel(limits: AppUsageLimits): string {
	if (limits.status) return `${limits.label} • ${limits.status}`;
	return `${limits.label} • ${limits.windows
		.map(
			(window) =>
				`${window.label} ${window.remainingPercent}% left, resets in ${window.resetText}`,
		)
		.join(" • ")}`;
}

function usageRing(percent: number, className: string): string {
	const circumference = 2 * Math.PI * 10;
	return syncHtml(
		<svg class="usage-ring" viewBox="0 0 24 24" aria-hidden="true">
			<circle
				cx="12"
				cy="12"
				r="10"
				fill="none"
				stroke="currentColor"
				stroke-width="3"
				class="usage-ring-track"
			/>
			<circle
				cx="12"
				cy="12"
				r="10"
				fill="none"
				stroke="currentColor"
				stroke-width="3"
				stroke-linecap="round"
				class={`${className} usage-ring-value`}
				stroke-dasharray={circumference}
				stroke-dashoffset={
					circumference - (clampPercent(percent) / 100) * circumference
				}
			/>
		</svg>,
	);
}

function usageColor(percent: number): string {
	return percent > 90 ? "usage-ring-danger" : "usage-ring-normal";
}

function clampPercent(value: number): number {
	return Math.min(100, Math.max(0, value));
}

export function loaderIcon() {
	return <Icon icon={Loader} label="Loading" role="status" class="icon-spin" />;
}

/**
 * Renders `ctx.ui.setWorkingIndicator()`'s configuration:
 * - `undefined` (no override) restores the default animated spinner icon.
 * - `frames: []` hides the indicator glyph entirely (the working message
 *   text can still show).
 * - a single frame renders as a static glyph.
 * - multiple frames cycle client-side via a pure-CSS animation (see
 *   `.working-indicator-frames` in prompt-status.css) when the frame count
 *   has precomputed keyframes, else falls back to a static first frame.
 */
function renderWorkingIndicator(indicator: AppExtensionWorkingIndicator | undefined) {
	if (indicator === undefined) return loaderIcon();
	const { frames } = indicator;
	if (frames.length === 0) return undefined;
	if (frames.length === 1 || !animatedFrameCounts.has(frames.length)) {
		return <span safe>{frames[0]}</span>;
	}
	const intervalMs = indicator.intervalMs ?? 120;
	const duration = frames.length * intervalMs;
	return (
		<span class="working-indicator-frames">
			{frames.map((frame, index) => (
				<span
					class="working-indicator-frame"
					style={`animation-name: working-indicator-cycle-${frames.length}; animation-duration: ${duration}ms; animation-delay: ${-1 * index * intervalMs}ms`}
					safe
				>
					{frame}
				</span>
			))}
		</span>
	);
}
