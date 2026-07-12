import type { AgentSessionRuntime, SessionStats } from "@earendil-works/pi-coding-agent";

import type { AppStore, AppUsage } from "../state/app-store.ts";
import { CodexUsageRequestTracker } from "./codex-usage-request.ts";
import {
	codexUsageTtlMs,
	fetchCodexUsage,
	formatCodexUsage,
	isOpenAICodex,
	type CodexUsage,
} from "./codex-usage.ts";

export class UsageController {
	private codexText = "";
	private codexUsage: CodexUsage | undefined;
	private fetchedAt = 0;
	private readonly requests = new CodexUsageRequestTracker();
	private timer: ReturnType<typeof setTimeout> | undefined;

	constructor(
		private readonly getRuntime: () => AgentSessionRuntime,
		private readonly state: AppStore,
		private readonly fetchUsage = fetchCodexUsage,
	) {}

	sync(): void {
		this.state.setUsage(
			formatStats(
				this.getRuntime().session.getSessionStats(),
				this.codexText,
				this.codexUsage,
			),
		);
	}

	reset(): void {
		this.invalidate();
		this.codexText = "";
		this.codexUsage = undefined;
		this.fetchedAt = 0;
	}

	refresh(force = false): void {
		const runtime = this.getRuntime();
		const session = runtime.session;
		if (!isOpenAICodex(session.model)) {
			this.reset();
			this.sync();
			return;
		}
		if (
			this.requests.loading ||
			(!force && Date.now() - this.fetchedAt < codexUsageTtlMs)
		)
			return;
		const request = this.requests.begin(runtime, session, session.model);
		if (!this.codexText) {
			this.codexText = "loading";
			this.sync();
		}
		void this.fetchUsage(session)
			.then((usage) => {
				if (!this.owns(request)) return;
				this.codexText = usage ? formatCodexUsage(usage) : "unavailable";
				this.codexUsage = usage;
				this.fetchedAt = Date.now();
				this.sync();
			})
			.catch((error: unknown) => {
				if (!this.owns(request)) return;
				console.warn("Failed to fetch Codex usage", error);
				this.codexText = "unavailable";
				this.codexUsage = undefined;
				this.fetchedAt = Date.now();
				this.sync();
			})
			.finally(() => {
				const current = this.getRuntime();
				if (
					!this.requests.release(
						request,
						current,
						current.session,
						current.session.model,
					)
				)
					return;
				this.schedule();
			});
	}

	dispose(): void {
		this.invalidate();
	}

	private owns(request: ReturnType<CodexUsageRequestTracker["begin"]>): boolean {
		const runtime = this.getRuntime();
		return this.requests.owns(
			request,
			runtime,
			runtime.session,
			runtime.session.model,
		);
	}

	private invalidate(): void {
		this.requests.invalidate();
		if (this.timer) clearTimeout(this.timer);
		this.timer = undefined;
	}

	private schedule(): void {
		if (this.timer) clearTimeout(this.timer);
		this.timer = setTimeout(() => {
			this.timer = undefined;
			this.refresh(true);
		}, codexUsageTtlMs);
		this.timer.unref?.();
	}
}

export function formatStats(
	stats: SessionStats,
	codexUsageText = "",
	codexUsage?: CodexUsage,
): AppUsage {
	const cost = formatCost(stats.cost);
	if (stats.contextUsage) {
		return {
			text: `${cost} • ${formatPercent(stats.contextUsage.percent)}/${formatTokens(stats.contextUsage.contextWindow)}`,
			contextPercent: stats.contextUsage.percent ?? undefined,
			codexText: codexUsageText || undefined,
			codexPrimaryPercent: codexUsage?.primary?.usedPercent,
			codexSecondaryPercent: codexUsage?.secondary?.usedPercent,
		};
	}
	return {
		text: `${cost} • ${formatTokens(stats.tokens.total)} tokens`,
		codexText: codexUsageText || undefined,
		codexPrimaryPercent: codexUsage?.primary?.usedPercent,
		codexSecondaryPercent: codexUsage?.secondary?.usedPercent,
	};
}

export function formatTokens(count: number): string {
	if (count < 1_000) return count.toString();
	if (count < 10_000) return `${(count / 1_000).toFixed(1)}k`;
	if (count < 1_000_000) return `${Math.round(count / 1_000)}k`;
	if (count < 10_000_000) return `${(count / 1_000_000).toFixed(1)}M`;
	return `${Math.round(count / 1_000_000)}M`;
}

function formatCost(cost: number): string {
	if (cost < 1) return `$${cost.toFixed(3)}`;
	if (cost < 100) return `$${cost.toFixed(1)}`;
	return `$${Math.round(cost)}`;
}

function formatPercent(value: number | null): string {
	return typeof value === "number" ? `${value.toFixed(1)}%` : "?";
}
