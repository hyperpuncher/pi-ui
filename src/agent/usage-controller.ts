import type { AgentSessionRuntime, SessionStats } from "@earendil-works/pi-coding-agent";

import type {
	AppStore,
	AppUsage,
	AppUsageLimits,
	AppUsageLimitWindow,
} from "../state/app-store.ts";
import { formatTokens } from "../utils/format.ts";
import {
	describeCodexUsage,
	fetchCodexUsage,
	isOpenAICodex,
	type CodexUsage,
} from "./codex-usage.ts";
import {
	describeOpenCodeGoUsage,
	fetchOpenCodeGoUsage,
	isOpenCodeGo,
	type OpenCodeGoUsage,
} from "./opencode-go-usage.ts";
import { providerUsageTtlMs } from "./provider-usage.ts";
import { UsageRequestTracker } from "./usage-request.ts";

type LimitProvider = "codex" | "opencode-go";
type UsageState = Pick<AppStore, "setUsage">;
type LimitUsageResult =
	| { provider: "codex"; usage: CodexUsage | undefined }
	| { provider: "opencode-go"; usage: OpenCodeGoUsage | undefined };

export class UsageController {
	private codexStatus = "";
	private codexUsage: CodexUsage | undefined;
	private codexFetchedAt = 0;
	private opencodeGoStatus = "";
	private opencodeGoUsage: OpenCodeGoUsage | undefined;
	private opencodeGoFetchedAt = 0;
	private readonly requests = new UsageRequestTracker();
	private timer: ReturnType<typeof setTimeout> | undefined;

	constructor(
		private readonly getRuntime: () => AgentSessionRuntime,
		private readonly state: UsageState,
		private readonly fetchCodex = fetchCodexUsage,
		private readonly fetchOpenCodeGo = fetchOpenCodeGoUsage,
	) {}

	sync(): void {
		const session = this.getRuntime().session;
		const showCodexUsage = isOpenAICodex(session.model);
		const showOpenCodeGoUsage = isOpenCodeGo(session.model);
		const stats = session.getSessionStats();
		this.state.setUsage(
			formatStats(stats, {
				cacheHitPercent: cumulativeCacheHitPercent(stats),
				limits: showCodexUsage
					? usageLimits(
							"Codex limits",
							this.codexStatus,
							this.codexUsage
								? describeCodexUsage(this.codexUsage)
								: undefined,
						)
					: showOpenCodeGoUsage
						? usageLimits(
								"OpenCode Go usage",
								this.opencodeGoStatus,
								this.opencodeGoUsage
									? describeOpenCodeGoUsage(this.opencodeGoUsage)
									: undefined,
							)
						: undefined,
			}),
		);
	}

	suspend(): void {
		this.invalidate();
	}

	refresh(force = false): void {
		const runtime = this.getRuntime();
		const session = runtime.session;
		const provider = limitProvider(session.model);
		if (!provider) {
			this.suspend();
			this.sync();
			return;
		}
		if (
			this.requests.loading ||
			(!force && Date.now() - this.fetchedAt(provider) < providerUsageTtlMs)
		)
			return;
		const request = this.requests.begin(runtime, session, session.model);
		if (!this.hasUsageState(provider)) {
			this.setUsageStatus(provider, "loading");
			this.sync();
		}
		void this.fetchProviderUsage(provider, session)
			.then((result) => {
				if (!this.owns(request)) return;
				this.setUsageResult(result, result.usage ? "" : "unavailable");
				this.sync();
			})
			.catch((error: ErrorOptions["cause"]) => {
				if (!this.owns(request)) return;
				console.warn(`Failed to fetch ${provider} usage`, error);
				this.setUsageResult({ provider, usage: undefined }, "unavailable");
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
		this.suspend();
	}

	private fetchProviderUsage(
		provider: LimitProvider,
		session: AgentSessionRuntime["session"],
	): Promise<LimitUsageResult> {
		return provider === "codex"
			? this.fetchCodex(session).then((usage) => ({ provider, usage }))
			: this.fetchOpenCodeGo(session).then((usage) => ({ provider, usage }));
	}

	private hasUsageState(provider: LimitProvider): boolean {
		return provider === "codex"
			? this.codexFetchedAt > 0 || !!this.codexStatus
			: this.opencodeGoFetchedAt > 0 || !!this.opencodeGoStatus;
	}

	private fetchedAt(provider: LimitProvider): number {
		return provider === "codex" ? this.codexFetchedAt : this.opencodeGoFetchedAt;
	}

	private setUsageStatus(provider: LimitProvider, status: string): void {
		if (provider === "codex") this.codexStatus = status;
		else this.opencodeGoStatus = status;
	}

	private setUsageResult(result: LimitUsageResult, status: string): void {
		if (result.provider === "codex") {
			this.codexStatus = status;
			this.codexUsage = result.usage;
			this.codexFetchedAt = Date.now();
			return;
		}
		this.opencodeGoStatus = status;
		this.opencodeGoUsage = result.usage;
		this.opencodeGoFetchedAt = Date.now();
	}

	private owns(request: ReturnType<UsageRequestTracker["begin"]>): boolean {
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
		}, providerUsageTtlMs);
		this.timer.unref?.();
	}
}

export function formatStats(
	stats: SessionStats,
	options: { cacheHitPercent?: number; limits?: AppUsageLimits } = {},
): AppUsage {
	const costText = formatCost(stats.cost);
	if (stats.contextUsage) {
		return {
			text: `${costText} • ${formatPercent(stats.contextUsage.percent)}/${formatTokens(stats.contextUsage.contextWindow)}`,
			costText,
			contextPercent: stats.contextUsage.percent ?? undefined,
			contextTokens: stats.contextUsage.tokens ?? undefined,
			contextWindow: stats.contextUsage.contextWindow,
			cacheHitPercent: options.cacheHitPercent,
			limits: options.limits,
		};
	}
	return {
		text: `${costText} • ${formatTokens(stats.tokens.total)} tokens`,
		costText,
		cacheHitPercent: options.cacheHitPercent,
		limits: options.limits,
	};
}

export function cumulativeCacheHitPercent(
	stats: Pick<SessionStats, "tokens">,
): number | undefined {
	const { input, cacheRead, cacheWrite } = stats.tokens;
	const promptTokens = input + cacheRead + cacheWrite;
	return promptTokens > 0 ? (cacheRead / promptTokens) * 100 : undefined;
}

function usageLimits(
	label: string,
	status: string,
	windows: readonly AppUsageLimitWindow[] | undefined,
): AppUsageLimits | undefined {
	if (!status && !windows?.length) return undefined;
	return {
		label,
		status: windows?.length ? undefined : status,
		windows: windows ?? [],
	};
}

function limitProvider(
	model: { provider?: string } | undefined,
): LimitProvider | undefined {
	if (isOpenAICodex(model)) return "codex";
	if (isOpenCodeGo(model)) return "opencode-go";
	return undefined;
}

function formatCost(cost: number): string {
	if (cost < 1) return `$${cost.toFixed(3)}`;
	if (cost < 100) return `$${cost.toFixed(1)}`;
	return `$${Math.round(cost)}`;
}

function formatPercent(value: number | null): string {
	return value === null ? "?" : `${value.toFixed(1)}%`;
}
