import type { AppUsage, AppUsageLimits } from "../state/app-store.ts";
import type { AppStateSnapshot } from "../state/app-store.ts";
import { formatTokens } from "../utils/format.ts";
import { Icon } from "./icon.tsx";
import { Loader } from "./icons.ts";
import { syncHtml } from "./sync-html.ts";

export function renderPromptStatus(state: AppStateSnapshot): string {
	const activityText = state.extensionWorkingMessage ?? state.activityText;
	return syncHtml(
		<span id="prompt-status" class="prompt-status">
			<span
				class="prompt-status-message"
				data-show="$_promptSubmitting"
				style="display: none"
			>
				{loaderIcon()}
				<span>Sending...</span>
			</span>
			{state.extensionWorkingVisible && activityText && (
				<span class="prompt-working-status">
					<span class="prompt-working-content">
						{state.extensionWorkingIndicator === undefined
							? loaderIcon()
							: state.extensionWorkingIndicator && (
									<span safe>{state.extensionWorkingIndicator}</span>
								)}
						<span safe>{activityText}</span>
					</span>
				</span>
			)}
			{state.extensionStatuses.map((status) => (
				<span class="extension-status" data-extension-status={status.key} safe>
					{status.text}
				</span>
			))}
			<span class="usage-indicators">{renderUsageIndicator(state.usage)}</span>
		</span>,
	);
}

function renderUsageIndicator(usage: AppUsage): string {
	const contextPercent = usage.contextPercent ?? 0;
	const limitPercent = usage.limits
		? Math.max(0, ...usage.limits.windows.map((window) => window.usedPercent))
		: 0;
	return syncHtml(
		<span class="usage-indicators">
			<span
				class="usage-indicator"
				data-tooltip="Context usage"
				aria-label={usage.text}
			>
				{usageRing(contextPercent, usageColor(contextPercent))}
				{renderContextTooltip(usage)}
			</span>
			{usage.limits && (
				<span
					class="usage-indicator"
					data-tooltip={usage.limits.label}
					aria-label={formatLimitsAriaLabel(usage.limits)}
				>
					{usageRing(limitPercent, usageColor(limitPercent))}
					{renderLimitsTooltip(usage.limits)}
				</span>
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
