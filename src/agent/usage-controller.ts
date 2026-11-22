import type { AgentSessionRuntime, SessionStats } from "@earendil-works/pi-coding-agent";

import {
	describeCodexUsage,
	fetchCodexUsage,
	showsCodexUsage,
} from "#src/agent/codex-usage.ts";
import { requestExtensionQuota } from "#src/agent/extension-quota.ts";
import { limitsFromMessages } from "#src/agent/limit-diagnostics.ts";
import {
	describeOpenCodeGoUsage,
	fetchOpenCodeGoUsage,
	isOpenCodeGo,
} from "#src/agent/opencode-go-usage.ts";
import { providerUsageTtlMs } from "#src/agent/provider-usage.ts";
import { UsageRequestTracker } from "#src/agent/usage-request.ts";
import type {
	AppStore,
	AppUsage,
	AppUsageLimits,
	AppUsageLimitWindow,
} from "#src/state/app-store.ts";
import { formatTokens } from "#src/utils/format.ts";

type UsageState = Pick<AppStore, "setUsage">;
type Session = AgentSessionRuntime["session"];
type DescribeWindows = () => readonly AppUsageLimitWindow[];

type LimitSource = {
	id: string;
	label: string;
	matches(model: Session["model"]): boolean;
	load(session: Session): Promise<DescribeWindows | undefined>;
	status?: string;
	describe?: DescribeWindows;
	fetchedAt?: number;
};

export class UsageController {
	private readonly sources: readonly LimitSource[] = [
		{
			id: "codex",
			label: "Codex limits",
			matches: showsCodexUsage,
			load: async (session) => {
				const usage = await this.loadCodex(session);
				return usage && (() => describeCodexUsage(usage));
			},
		},
		{
			id: "opencode-go",
			label: "OpenCode Go usage",
			matches: isOpenCodeGo,
			load: async (session) => {
				const usage = await this.loadOpenCodeGo(session);
				return usage && (() => describeOpenCodeGoUsage(usage));
			},
		},
	];
	private extensionLimits?: AppUsageLimits;
	private readonly requests = new UsageRequestTracker();
	private timer: ReturnType<typeof setTimeout> | undefined;

	constructor(
		private readonly getRuntime: () => AgentSessionRuntime,
		private readonly state: UsageState,
		private readonly loadCodex = fetchCodexUsage,
		private readonly loadOpenCodeGo = fetchOpenCodeGoUsage,
	) {}

	sync(): void {
		const session = this.getRuntime().session;
		const source = this.sources.find((item) => item.matches(session.model));
		const provider = session.model?.provider;
		const stats = session.getSessionStats();
		this.state.setUsage(
			formatStats(stats, {
				cacheHitPercent: cumulativeCacheHitPercent(stats),
				compactionCount: session.sessionManager
					.getBranch()
					.filter((entry) => entry.type === "compaction").length,
				limits: source
					? polledLimits(source)
					: (this.extensionLimits ??
						(provider
							? limitsFromMessages(session.messages, provider)
							: undefined)),
			}),
		);
	}

	suspend(): void {
		this.extensionLimits = undefined;
		this.invalidate();
	}

	refresh(force = false): void {
		const runtime = this.getRuntime();
		const session = runtime.session;
		const source = this.sources.find((item) => item.matches(session.model));
		if (!source) {
			this.refreshExtension(runtime);
			return;
		}
		if (
			this.requests.loading ||
			(!force &&
				source.fetchedAt !== undefined &&
				Date.now() - source.fetchedAt < providerUsageTtlMs)
		)
			return;
		const request = this.requests.begin(runtime, session, session.model);
		if (source.fetchedAt === undefined && !source.status) {
			source.status = "loading";
			this.sync();
		}
		void source
			.load(session)
			.then((describe) => {
				if (!this.owns(request)) return;
				source.status = describe ? undefined : "unavailable";
				if (describe) source.describe = describe;
				source.fetchedAt = Date.now();
				this.sync();
			})
			.catch((error: ErrorOptions["cause"]) => {
				if (!this.owns(request)) return;
				if (
					error instanceof DOMException &&
					(error.name === "AbortError" || error.name === "TimeoutError")
				)
					console.warn(`${source.id} usage request timed out`);
				else console.warn(`Failed to fetch ${source.id} usage`, error);
				source.status = "unavailable";
				source.fetchedAt = Date.now();
				this.sync();
			})
			.finally(() => {
				const released = this.getRuntime();
				if (
					!this.requests.release(
						request,
						released,
						released.session,
						released.session.model,
					)
				)
					return;
				this.schedule();
			});
	}

	dispose(): void {
		this.suspend();
	}

	private refreshExtension(runtime: AgentSessionRuntime): void {
		if (this.requests.loading) return;
		const session = runtime.session;
		const pending = requestExtensionQuota(session);
		if (!pending) {
			this.suspend();
			this.sync();
			return;
		}
		const request = this.requests.begin(runtime, session, session.model);
		const unavailable: AppUsageLimits = {
			label: `${session.model?.provider} limits`,
			status: "unavailable",
			windows: [],
		};
		this.extensionLimits ??= { ...unavailable, status: "loading" };
		this.sync();
		const finish = (limits: AppUsageLimits | undefined) => {
			if (!this.owns(request)) return;
			this.requests.release(request, runtime, session, session.model);
			this.extensionLimits = limits ?? unavailable;
			this.sync();
			this.schedule();
		};
		void pending.then(finish, () => finish(undefined));
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
	options: {
		cacheHitPercent?: number;
		compactionCount?: number;
		limits?: AppUsageLimits;
	} = {},
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
			compactionCount: options.compactionCount,
			limits: options.limits,
		};
	}
	return {
		text: `${costText} • ${formatTokens(stats.tokens.total)} tokens`,
		costText,
		cacheHitPercent: options.cacheHitPercent,
		compactionCount: options.compactionCount,
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

function polledLimits(source: LimitSource): AppUsageLimits | undefined {
	const windows = source.describe?.() ?? [];
	if (!source.status && !windows.length) return undefined;
	return {
		label: source.label,
		status:
			source.status && windows.length
				? "stale (refresh unavailable)"
				: source.status,
		windows,
	};
}

function formatCost(cost: number): string {
	if (cost < 1) return `$${cost.toFixed(3)}`;
	if (cost < 100) return `$${cost.toFixed(1)}`;
	return `$${Math.round(cost)}`;
}

function formatPercent(value: number | null): string {
	return value === null ? "?" : `${value.toFixed(1)}%`;
}
