import type { AppUsage, AppUsageLimits } from "../state/app-store.ts";
import type { AppStateSnapshot } from "../state/app-store.ts";
import { formatTokens } from "../utils/format.ts";
import { Icon } from "./icon.tsx";
import { Loader } from "./icons.ts";
import { syncHtml } from "./sync-html.ts";

export function renderPromptStatus(state: AppStateSnapshot): string {
	const activityText = state.extensionWorkingMessage ?? state.activityText;
	return syncHtml(
		<span
			id="prompt-status"
			class="inline-flex h-8 min-w-0 shrink-0 items-center gap-2"
		>
			{state.extensionWorkingVisible && activityText && (
				<span class="inline-flex h-6 min-w-0 items-center truncate font-mono text-xs leading-none text-muted-foreground">
					<span class="inline-flex items-center gap-1.5">
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
				<span
					class="hidden max-w-40 truncate font-mono text-xs text-muted-foreground sm:inline"
					data-extension-status={status.key}
					safe
				>
					{status.text}
				</span>
			))}
			<span class="inline-flex shrink-0 items-center gap-1">
				{renderUsageIndicator(state.usage)}
			</span>
		</span>,
	);
}

function renderUsageIndicator(usage: AppUsage): string {
	const contextPercent = usage.contextPercent ?? 0;
	const limitPercent = usage.limits
		? Math.max(0, ...usage.limits.windows.map((window) => window.usedPercent))
		: 0;
	return syncHtml(
		<span class="inline-flex shrink-0 items-center gap-1.5 font-mono text-xs">
			<span
				class="group inline-flex size-4 shrink-0 items-center justify-center"
				data-tooltip="Context usage"
				aria-label={usage.text}
			>
				{usageRing(contextPercent, usageColor(contextPercent))}
				{renderContextTooltip(usage)}
			</span>
			{usage.limits && (
				<span
					class="group inline-flex size-4 shrink-0 items-center justify-center"
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
			class="grid w-60 max-w-none items-stretch gap-0 px-3 py-2.5 text-left"
		>
			{hasContext ? (
				<>
					<span class="mb-1.5 flex items-baseline justify-between gap-3">
						<strong class="font-mono text-xs font-semibold">
							Context usage
						</strong>
						<strong class="font-mono text-xs font-semibold">
							{Math.round(contextPercent)}% used
						</strong>
					</span>
					<span class="mb-1 flex items-baseline justify-between gap-3 font-mono text-[0.6875rem]">
						<strong class="font-semibold">
							{formatTokens(contextTokens)} tokens
						</strong>
						<span class="pi-inverse-fine-print">
							of {formatTokens(contextWindow)}
						</span>
					</span>
					<span class="h-1 overflow-hidden rounded-full bg-background/20">
						<span
							class="block h-full rounded-full bg-background"
							style={`width: ${clampPercent(contextPercent)}%`}
						/>
					</span>
					<span class="pi-inverse-fine-print mt-1.5 flex items-baseline justify-between gap-3 font-mono text-[0.625rem]">
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
					<span class="mb-1 flex items-baseline justify-between gap-3 font-mono">
						<strong class="text-xs font-semibold">Context usage</strong>
						<span class="pi-inverse-fine-print text-[0.625rem]">
							{usage.costText} session
						</span>
					</span>
					<span class="pi-inverse-fine-print font-mono text-[0.6875rem]">
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
			class="grid w-52 max-w-none items-stretch gap-0 px-3 py-2.5 text-left"
		>
			<strong class="mb-2 font-mono text-xs font-semibold">{limits.label}</strong>
			{limits.status && (
				<span class="pi-inverse-fine-print font-mono text-[0.6875rem]">
					{limits.status}
				</span>
			)}
			{limits.windows.map((window, index) => (
				<span class={index === 0 ? "grid gap-0.5" : "mt-2 grid gap-0.5"}>
					<span class="flex items-baseline justify-between gap-4 font-mono text-[0.6875rem]">
						<strong class="font-semibold">{window.label}</strong>
						<strong class="font-semibold">
							{window.remainingPercent}% left
						</strong>
					</span>
					<span class="h-1 overflow-hidden rounded-full bg-background/20">
						<span
							class="block h-full rounded-full bg-background"
							style={`width: ${clampPercent(window.remainingPercent)}%`}
						/>
					</span>
					<span class="pi-inverse-fine-print text-right font-mono text-[0.625rem]">
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
		<svg
			class="size-4 -rotate-90 opacity-60 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100"
			viewBox="0 0 24 24"
			aria-hidden="true"
		>
			<circle
				cx="12"
				cy="12"
				r="10"
				fill="none"
				stroke="currentColor"
				stroke-width="3"
				class="text-muted-foreground/20"
			/>
			<circle
				cx="12"
				cy="12"
				r="10"
				fill="none"
				stroke="currentColor"
				stroke-width="3"
				stroke-linecap="round"
				class={className}
				stroke-dasharray={circumference}
				stroke-dashoffset={
					circumference - (clampPercent(percent) / 100) * circumference
				}
			/>
		</svg>,
	);
}

function usageColor(percent: number): string {
	return percent > 90 ? "text-destructive" : "text-foreground";
}

function clampPercent(value: number): number {
	return Math.min(100, Math.max(0, value));
}

export function loaderIcon() {
	return (
		<Icon icon={Loader} label="Loading" role="status" class="size-3 animate-spin" />
	);
}
