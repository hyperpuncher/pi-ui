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
type ProviderUsage = CodexUsage | OpenCodeGoUsage;

type ProviderUsageEntry = Readonly<{
	status: string;
	usage: ProviderUsage | undefined;
	fetchedAt: number;
}>;

/**
 * Shared, process-wide cache of the last-known Codex/OpenCode-Go quota plus any in-flight
 * request, so every `UsageController` in the process draws from one pool instead of polling
 * independently (Live Workspace depth, Round 2: "global provider-quota singleton — dedupe
 * polling across sessions"). A freshly constructed controller — e.g. after the runtime host is
 * recreated following a failure (`app.ts`'s `RuntimeController.create` fallback) — starts from
 * whatever quota is already cached instead of a blank "loading" state, and a `refresh()` that
 * lands while another instance's request for the same provider is still in flight joins it
 * rather than firing a second request against the same authenticated account.
 *
 * A real pi-ui process talks to at most one authenticated account per provider at a time, so
 * keying purely by provider (not by account, session or runtime) is sufficient here — the same
 * assumption `UsageRequestTracker` makes for a single instance's own in-flight request.
 *
 * Exported (rather than kept as bare module state) so tests can inject an isolated pool instead
 * of sharing the process-wide default — see `usage-controller_test.ts`.
 */
export class ProviderUsagePool {
	private readonly cache = new Map<LimitProvider, ProviderUsageEntry>();
	private readonly inFlight = new Map<LimitProvider, Promise<LimitUsageResult>>();

	// Overloads narrow `usage` to the provider's own type from a literal provider argument, so
	// callers never need to cast the union `ProviderUsage` back down themselves.
	get(
		provider: "codex",
	):
		| (Omit<ProviderUsageEntry, "usage"> & { usage: CodexUsage | undefined })
		| undefined;
	get(
		provider: "opencode-go",
	):
		| (Omit<ProviderUsageEntry, "usage"> & { usage: OpenCodeGoUsage | undefined })
		| undefined;
	get(provider: LimitProvider): ProviderUsageEntry | undefined;
	get(provider: LimitProvider): ProviderUsageEntry | undefined {
		return this.cache.get(provider);
	}

	setStatus(provider: LimitProvider, status: string): void {
		const existing = this.cache.get(provider);
		this.cache.set(provider, {
			status,
			usage: existing?.usage,
			fetchedAt: existing?.fetchedAt ?? 0,
		});
	}

	setResult(result: LimitUsageResult, status: string): void {
		const existing = this.cache.get(result.provider);
		this.cache.set(result.provider, {
			status,
			usage: result.usage ?? existing?.usage,
			fetchedAt: Date.now(),
		});
	}

	/** Runs `fetch` for `provider`, or returns the already-in-flight request for it. */
	fetch(
		provider: LimitProvider,
		run: () => Promise<LimitUsageResult>,
	): Promise<LimitUsageResult> {
		const existing = this.inFlight.get(provider);
		if (existing) return existing;
		const request = run().finally(() => {
			if (this.inFlight.get(provider) === request) this.inFlight.delete(provider);
		});
		this.inFlight.set(provider, request);
		return request;
	}
}

/** The default pool every production `UsageController` shares (see `ProviderUsagePool`). */
export const sharedProviderUsagePool = new ProviderUsagePool();

export class UsageController {
	private readonly requests = new UsageRequestTracker();
	private timer: ReturnType<typeof setTimeout> | undefined;

	constructor(
		private readonly getRuntime: () => AgentSessionRuntime,
		private readonly state: UsageState,
		private readonly fetchCodex = fetchCodexUsage,
		private readonly fetchOpenCodeGo = fetchOpenCodeGoUsage,
		private readonly pool = sharedProviderUsagePool,
	) {}

	sync(): void {
		const session = this.getRuntime().session;
		const showCodexUsage = isOpenAICodex(session.model);
		const showOpenCodeGoUsage = isOpenCodeGo(session.model);
		const stats = session.getSessionStats();
		const codex = this.pool.get("codex");
		const opencodeGo = this.pool.get("opencode-go");
		this.state.setUsage(
			formatStats(stats, {
				cacheHitPercent: cumulativeCacheHitPercent(stats),
				limits: showCodexUsage
					? usageLimits(
							"Codex limits",
							codex?.status ?? "",
							codex?.usage ? describeCodexUsage(codex.usage) : undefined,
						)
					: showOpenCodeGoUsage
						? usageLimits(
								"OpenCode Go usage",
								opencodeGo?.status ?? "",
								opencodeGo?.usage
									? describeOpenCodeGoUsage(opencodeGo.usage)
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
			(!force &&
				Date.now() - (this.pool.get(provider)?.fetchedAt ?? 0) <
					providerUsageTtlMs)
		)
			return;
		const request = this.requests.begin(runtime, session, session.model);
		if (!this.pool.get(provider)) {
			this.pool.setStatus(provider, "loading");
			this.sync();
		}
		void this.pool
			.fetch(provider, () => this.fetchProviderUsage(provider, session))
			.then((result) => {
				if (!this.owns(request)) return;
				this.pool.setResult(result, result.usage ? "" : "unavailable");
				this.sync();
			})
			.catch((error: ErrorOptions["cause"]) => {
				if (!this.owns(request)) return;
				if (error instanceof DOMException && error.name === "AbortError")
					console.warn(`${provider} usage request timed out`);
				else console.warn(`Failed to fetch ${provider} usage`, error);
				this.pool.setResult({ provider, usage: undefined }, "unavailable");
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
