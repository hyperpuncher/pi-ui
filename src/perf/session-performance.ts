import { AsyncLocalStorage } from "node:async_hooks";

const utf8Encoder = new TextEncoder();

// SDK 0.80.6 loads entries once for the header and again for manager state.
export const sdkInternalReadsPerSessionOpenEstimate = 2;

export const sessionPerformanceSpanNames = [
	"sessionOpen",
	"sessionManagerOpen",
	"runtimeSwitchCreate",
	"runtimeLifecycleOverhead",
	"runtimeServicesCreate",
	"scopedModelResolution",
	"runtimeSessionCreate",
	"runtimeRebind",
	"backgroundActivation",
	"extensionBind",
	"transcriptProjection",
	"firstTranscriptPatch",
	"toolEnhancement",
	"markdownEnhancement",
] as const;

export type SessionPerformanceSpanName = (typeof sessionPerformanceSpanNames)[number];

type SpanSummary = { count: number; totalMs: number; maxMs: number };
type SpanSnapshot = Record<SessionPerformanceSpanName, SpanSummary>;

type PerformanceCounters = {
	logicalSessionOpenCount: number;
	fatMorphCount: number;
	targetedMessagePatchCount: number;
	bytesRendered: number;
	backgroundLookupHitCount: number;
	backgroundLookupMissCount: number;
};

export type RuntimeLeaveAction = "background" | "discard" | "dispose" | "keep";
export type RuntimeOwnershipLocation =
	| "foreground"
	| "background-running"
	| "background-completed"
	| "disposed";

export type SessionOwnershipDiagnostics = {
	sourceGeneration?: number;
	sourceSdkStreaming?: boolean;
	sourceObservedRunning?: boolean;
	sourcePersisted?: boolean;
	leaveAction?: RuntimeLeaveAction;
	targetBackgroundLookup?: "hit" | "miss";
	sourceLocationBefore?: RuntimeOwnershipLocation;
	sourceLocationAfter?: RuntimeOwnershipLocation;
	targetLocationBefore?: RuntimeOwnershipLocation;
	targetLocationAfter?: RuntimeOwnershipLocation;
	ownedLiveRuntimeCount: number;
	duplicateKeyInvariantFailures: number;
};

export type SessionPerformanceSnapshot = PerformanceCounters & {
	enabled: boolean;
	spans: SpanSnapshot;
	sdkInternalReadsPerSessionOpenEstimate: number;
};

export type SessionTransitionPerformanceSnapshot = PerformanceCounters & {
	id: number;
	elapsedMs: number;
	spans: SpanSnapshot;
	ownership: SessionOwnershipDiagnostics;
};

export type SessionPerformanceRecord = {
	type: "pi-ui-session-performance";
	transition: SessionTransitionPerformanceSnapshot;
	cumulative: SessionPerformanceSnapshot;
};

type Transition = PerformanceCounters & {
	id: number;
	startedAt: number;
	hostComplete: boolean;
	transcriptProjected: boolean;
	firstPatchAt?: number;
	spans: SpanSnapshot;
	ownership: SessionOwnershipDiagnostics;
};

function emptySpans(): SpanSnapshot {
	return Object.fromEntries(
		sessionPerformanceSpanNames.map((name) => [
			name,
			{ count: 0, totalMs: 0, maxMs: 0 },
		]),
	) as SpanSnapshot;
}

function emptyCounters(): PerformanceCounters {
	return {
		logicalSessionOpenCount: 0,
		fatMorphCount: 0,
		targetedMessagePatchCount: 0,
		bytesRendered: 0,
		backgroundLookupHitCount: 0,
		backgroundLookupMissCount: 0,
	};
}

function emptyOwnershipDiagnostics(): SessionOwnershipDiagnostics {
	return {
		ownedLiveRuntimeCount: 0,
		duplicateKeyInvariantFailures: 0,
	};
}

class SessionPerformanceCollector {
	private spans = emptySpans();
	private counters = emptyCounters();
	private transitions = new Map<number, Transition>();
	private activeTransitionId: number | undefined;
	private nextTransitionId = 1;
	private readonly transitionContext = new AsyncLocalStorage<number>();

	get enabled(): boolean {
		return Deno.env.get("PI_UI_PERF") === "1";
	}

	reset(): void {
		this.spans = emptySpans();
		this.counters = emptyCounters();
		this.transitions.clear();
		this.activeTransitionId = undefined;
		this.nextTransitionId = 1;
	}

	snapshot(): SessionPerformanceSnapshot {
		return {
			enabled: this.enabled,
			spans: structuredClone(this.spans),
			...this.counters,
			sdkInternalReadsPerSessionOpenEstimate,
		};
	}

	runInTransition<T>(
		transitionId: number | undefined,
		operation: () => Promise<T>,
	): Promise<T> {
		return transitionId === undefined
			? operation()
			: this.transitionContext.run(transitionId, operation);
	}

	startSpan(name: SessionPerformanceSpanName, transitionId?: number): () => void {
		if (!this.enabled) return () => {};
		transitionId ??= this.currentTransitionId();
		const startedAt = performance.now();
		let ended = false;
		return () => {
			if (ended) return;
			ended = true;
			this.recordSpan(name, performance.now() - startedAt, transitionId);
		};
	}

	measureSync<T>(
		name: SessionPerformanceSpanName,
		operation: () => T,
		transitionId?: number,
	): T {
		const end = this.startSpan(name, transitionId);
		try {
			return operation();
		} finally {
			end();
		}
	}

	async measure<T>(
		name: SessionPerformanceSpanName,
		operation: () => Promise<T>,
		transitionId?: number,
	): Promise<T> {
		const end = this.startSpan(name, transitionId);
		try {
			return await operation();
		} finally {
			end();
		}
	}

	startSessionTransition(): number | undefined {
		if (!this.enabled) return undefined;
		const id = this.nextTransitionId++;
		this.transitions.set(id, {
			id,
			startedAt: performance.now(),
			hostComplete: false,
			transcriptProjected: false,
			spans: emptySpans(),
			ownership: emptyOwnershipDiagnostics(),
			...emptyCounters(),
		});
		this.activeTransitionId = id;
		return id;
	}

	markSessionTransitionComplete(transitionId?: number): void {
		const transition = this.getTransition(transitionId ?? this.currentTransitionId());
		if (!transition) return;
		transition.hostComplete = true;
		this.finishTransitionIfReady(transition);
	}

	cancelSessionTransition(transitionId?: number): void {
		transitionId ??= this.currentTransitionId();
		if (!this.enabled || transitionId === undefined) return;
		this.transitions.delete(transitionId);
		if (this.activeTransitionId === transitionId) {
			this.activeTransitionId = undefined;
		}
	}

	markTranscriptProjected(transitionId?: number): void {
		const transition = this.getTransition(transitionId ?? this.currentTransitionId());
		if (transition) transition.transcriptProjected = true;
	}

	markFirstTranscriptPatch(transitionId?: number): void {
		transitionId ??= this.currentTransitionId();
		const transition = this.getTransition(transitionId);
		if (!transition?.transcriptProjected || transition.firstPatchAt) return;
		transition.firstPatchAt = performance.now();
		this.recordSpan(
			"firstTranscriptPatch",
			transition.firstPatchAt - transition.startedAt,
			transition.id,
		);
		this.finishTransitionIfReady(transition);
	}

	recordSessionOpen(transitionId?: number): void {
		this.incrementCounter(
			"logicalSessionOpenCount",
			1,
			transitionId ?? this.currentTransitionId(),
		);
	}

	recordOwnershipDiagnostics(
		diagnostics: Partial<SessionOwnershipDiagnostics>,
		transitionId?: number,
	): void {
		if (!this.enabled) return;
		const transition = this.getTransition(transitionId ?? this.currentTransitionId());
		if (!transition) return;
		if (
			diagnostics.targetBackgroundLookup &&
			transition.ownership.targetBackgroundLookup === undefined
		) {
			this.incrementCounter(
				diagnostics.targetBackgroundLookup === "hit"
					? "backgroundLookupHitCount"
					: "backgroundLookupMissCount",
				1,
				transition.id,
			);
		}
		Object.assign(transition.ownership, diagnostics);
	}

	recordFatMorph(html: string, transitionId?: number): void {
		if (!this.enabled) return;
		transitionId ??= this.currentTransitionId();
		this.incrementCounter("fatMorphCount", 1, transitionId);
		this.incrementCounter(
			"bytesRendered",
			utf8Encoder.encode(html).byteLength,
			transitionId,
		);
	}

	recordTargetedMessagePatch(html: string, transitionId?: number): void {
		if (!this.enabled) return;
		transitionId ??= this.currentTransitionId();
		this.incrementCounter("targetedMessagePatchCount", 1, transitionId);
		this.incrementCounter(
			"bytesRendered",
			utf8Encoder.encode(html).byteLength,
			transitionId,
		);
	}

	private currentTransitionId(): number | undefined {
		return this.transitionContext.getStore() ?? this.activeTransitionId;
	}

	private getTransition(id: number | undefined): Transition | undefined {
		return this.enabled && id !== undefined ? this.transitions.get(id) : undefined;
	}

	private incrementCounter(
		name: keyof PerformanceCounters,
		amount: number,
		transitionId: number | undefined,
	): void {
		if (!this.enabled) return;
		this.counters[name] += amount;
		const transition = this.getTransition(transitionId);
		if (transition) transition[name] += amount;
	}

	private recordSpan(
		name: SessionPerformanceSpanName,
		durationMs: number,
		transitionId?: number,
	): void {
		if (!this.enabled) return;
		updateSpan(this.spans[name], durationMs);
		const transition = this.getTransition(transitionId);
		if (transition) updateSpan(transition.spans[name], durationMs);
	}

	private finishTransitionIfReady(transition: Transition): void {
		if (!transition.hostComplete || transition.firstPatchAt === undefined) return;
		const elapsedMs = performance.now() - transition.startedAt;
		this.recordSpan("sessionOpen", elapsedMs, transition.id);
		setRuntimeLifecycleRemainder(transition.spans);
		this.transitions.delete(transition.id);
		if (this.activeTransitionId === transition.id) {
			this.activeTransitionId = undefined;
		}
		const record: SessionPerformanceRecord = {
			type: "pi-ui-session-performance",
			transition: {
				id: transition.id,
				elapsedMs,
				spans: structuredClone(transition.spans),
				logicalSessionOpenCount: transition.logicalSessionOpenCount,
				fatMorphCount: transition.fatMorphCount,
				targetedMessagePatchCount: transition.targetedMessagePatchCount,
				bytesRendered: transition.bytesRendered,
				backgroundLookupHitCount: transition.backgroundLookupHitCount,
				backgroundLookupMissCount: transition.backgroundLookupMissCount,
				ownership: structuredClone(transition.ownership),
			},
			cumulative: this.snapshot(),
		};
		console.log(JSON.stringify(record));
	}
}

function updateSpan(span: SpanSummary, durationMs: number): void {
	span.count += 1;
	span.totalMs += durationMs;
	span.maxMs = Math.max(span.maxMs, durationMs);
}

function setRuntimeLifecycleRemainder(spans: SpanSnapshot): void {
	const total = spans.runtimeSwitchCreate.totalMs;
	if (total === 0) return;
	const measured = [
		spans.runtimeServicesCreate,
		spans.scopedModelResolution,
		spans.runtimeSessionCreate,
		spans.runtimeRebind,
	].reduce((sum, span) => sum + span.totalMs, 0);
	const remainder = Math.max(0, total - measured);
	spans.runtimeLifecycleOverhead = {
		count: spans.runtimeSwitchCreate.count,
		totalMs: remainder,
		maxMs: remainder,
	};
}

export const sessionPerformance = new SessionPerformanceCollector();
