import type { AppRenderSnapshot, AppUsage } from "../state/app-store.ts";

export function renderPromptStatus(state: AppRenderSnapshot): string {
	return (
		<span
			id="prompt-status"
			class="inline-flex h-8 min-w-0 shrink-0 items-center gap-2"
		>
			{state.activityText && (
				<span class="text-muted-foreground inline-flex h-6 min-w-0 items-center truncate font-mono text-xs leading-none">
					<span class="inline-flex items-center gap-1.5">
						{loaderIcon()}
						<span safe>{state.activityText}</span>
					</span>
				</span>
			)}
			<span class="inline-flex shrink-0 items-center gap-1">
				{renderUsageIndicator(state.usage)}
			</span>
		</span>
	) as string;
}

function renderUsageIndicator(usage: AppUsage): string {
	const contextPercent = usage.contextPercent ?? 0;
	const circumference = 2 * Math.PI * 10;
	return (
		<span class="inline-flex shrink-0 items-center gap-1.5 font-mono text-xs">
			<span
				class="group inline-flex size-4 shrink-0 items-center justify-center"
				data-tooltip={usage.text}
				data-tooltip-multiline
				aria-label={usage.text}
			>
				{usageRing({
					circumference,
					rings: [
						{
							percent: contextPercent,
							className: contextUsageColor(contextPercent),
						},
					],
				})}
			</span>
			{usage.codexText && (
				<span
					class="group inline-flex size-4 shrink-0 items-center justify-center"
					data-tooltip={`codex limits\n${usage.codexText.replace("  ", "\n")}`}
					data-tooltip-multiline
					aria-label={`codex limits • ${usage.codexText}`}
				>
					{usageRing({
						circumference,
						rings: [
							{
								percent: usage.codexSecondaryPercent ?? 0,
								className: codexUsageColor(
									usage.codexSecondaryPercent ?? 0,
									"secondary",
								),
							},
							{
								percent: usage.codexPrimaryPercent ?? 0,
								className: codexUsageColor(
									usage.codexPrimaryPercent ?? 0,
									"primary",
								),
							},
						],
					})}
				</span>
			)}
		</span>
	) as string;
}

function usageRing(props: {
	circumference: number;
	rings: { percent: number; className: string }[];
}): string {
	return (
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
			{props.rings.map((ring) => (
				<circle
					cx="12"
					cy="12"
					r="10"
					fill="none"
					stroke="currentColor"
					stroke-width="3"
					stroke-linecap="round"
					class={ring.className}
					stroke-dasharray={props.circumference}
					stroke-dashoffset={usageDashOffset(ring.percent, props.circumference)}
				/>
			))}
		</svg>
	) as string;
}

function usageDashOffset(percent: number, circumference: number): number {
	return circumference - (Math.min(100, Math.max(0, percent)) / 100) * circumference;
}

function contextUsageColor(percent: number): string {
	return usageColor(percent, "primary");
}

function codexUsageColor(percent: number, layer: "primary" | "secondary"): string {
	return usageColor(percent, layer);
}

function usageColor(percent: number, layer: "primary" | "secondary"): string {
	if (percent > 90) return "text-destructive";
	return layer === "primary" ? "text-foreground" : "text-muted-foreground/45";
}

export function loaderIcon() {
	return (
		<svg
			aria-label="Loading"
			role="status"
			class="lucide lucide-loader size-3 animate-spin"
			xmlns="http://www.w3.org/2000/svg"
			viewBox="0 0 24 24"
			fill="none"
			stroke="currentColor"
			stroke-width="2"
			stroke-linecap="round"
			stroke-linejoin="round"
		>
			<path d="M12 2v4m4.2 1.8l2.9-2.9M18 12h4m-5.8 4.2l2.9 2.9M12 18v4m-7.1-2.9l2.9-2.9M2 12h4M4.9 4.9l2.9 2.9" />
		</svg>
	);
}
