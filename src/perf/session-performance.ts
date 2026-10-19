import { AsyncLocalStorage } from "node:async_hooks";

import { appendSessionPerformanceRecord } from "#src/perf/session-performance-log.ts";

const sessionPerformanceSpanNames = [
	"sessionOpen",
	"sessionManagerOpen",
	"runtimeSwitchCreate",
	"runtimeDispose",
	"runtimeServicesCreate",
	"scopedModelResolution",
	"runtimeSessionCreate",
	"runtimeRebind",
	"backgroundActivation",
	"extensionBind",
	"transcriptProjection",
	"transcriptInstall",
	"stateSnapshot",
	"signalRender",
	"transcriptRender",
	"viewRender",
	"sidebarRender",
	"firstTranscriptPatch",
	"runtimeReady",
	"toolEnhancement",
	"markdownEnhancement",
] as const;

type SessionPerformanceSpanName = (typeof sessionPerformanceSpanNames)[number];

type SpanSummary = { count: number; totalMs: number; maxMs: number };
type SpanSnapshot = Record<SessionPerformanceSpanName, SpanSummary>;

type PerformanceCounters = {
	logicalSessionOpenCount: number;
	patches: Record<
		PatchRegion,
		{ count: number; deliveries: number; htmlBytes: number }
	>;
	backgroundLookupHitCount: number;
	backgroundLookupMissCount: number;
};

export type PatchRegion =
	| "transcript"
	| "message"
	| "view"
	| "sidebar"
	| "initial"
	| "other";

export type ClientTransitionMetrics = {
	runId: string;
	pageId: string;
	generation: number;
	origin: "command" | "observer";
	loadingObservedMs: number;
	firstTranscriptPatchMs: number;
	firstTranscriptFrameMs: number;
	readyObservedMs: number;
	readyFrameMs: number;
};

type RuntimeLeaveAction = "background" | "discard" | "dispose" | "keep";
type RuntimeOwnershipLocation =
	| "foreground"
	| "background-running"
	| "background-completed"
	| "disposed";

type SessionOwnershipDiagnostics = {
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

type SessionPerformanceSnapshot = PerformanceCounters & {
	runId: string;
	enabled: boolean;
	spans: SpanSnapshot;
};

type SessionTransitionPerformanceSnapshot = PerformanceCounters & {
	id: number;
	generation?: number;
	elapsedMs: number;
	spans: SpanSnapshot;
	ownership: SessionOwnershipDiagnostics;
};

type SessionPerformanceRecord = {
	type: "pi-ui-session-performance";
	schemaVersion: 2;
	runId: string;
	transition: SessionTransitionPerformanceSnapshot;
	cumulative: SessionPerformanceSnapshot;
};

type Transition = PerformanceCounters & {
	id: number;
	generation?: number;
	startedAt: number;
	transcriptProjected: boolean;
	firstPatchAt?: number;
	spans: SpanSnapshot;
	ownership: SessionOwnershipDiagnostics;
};

function emptySpans(): SpanSnapshot {
	// SAFETY: The entries are generated from the same tuple that defines every snapshot key.
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
		patches: {
			transcript: { count: 0, deliveries: 0, htmlBytes: 0 },
			message: { count: 0, deliveries: 0, htmlBytes: 0 },
			view: { count: 0, deliveries: 0, htmlBytes: 0 },
			sidebar: { count: 0, deliveries: 0, htmlBytes: 0 },
			initial: { count: 0, deliveries: 0, htmlBytes: 0 },
			other: { count: 0, deliveries: 0, htmlBytes: 0 },
		},
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

const noop = () => {};

class SessionPerformanceCollector {
	readonly runId = crypto.randomUUID();
	private spans = emptySpans();
	private counters = emptyCounters();
	private transitions = new Map<number, Transition>();
	private activeTransitionId: number | undefined;
	private nextTransitionId = 1;
	private readonly transitionContext = new AsyncLocalStorage<number>();

	get enabled(): boolean {
		return process.env.PI_UI_PERF === "1";
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
			runId: this.runId,
			enabled: this.enabled,
			spans: structuredClone(this.spans),
			...structuredClone(this.counters),
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
		if (!this.enabled) return noop;
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
		if (!this.enabled) return operation();
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

	startSessionTransition(generation?: number): number | undefined {
		if (!this.enabled) return undefined;
		const id = this.nextTransitionId++;
		this.transitions.set(id, {
			id,
			generation,
			startedAt: performance.now(),
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
		this.recordSpan(
			"runtimeReady",
			performance.now() - transition.startedAt,
			transition.id,
		);
		this.finishTransition(transition);
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
		if (!transition?.transcriptProjected || transition.firstPatchAt !== undefined)
			return;
		transition.firstPatchAt = performance.now();
		this.recordSpan(
			"firstTranscriptPatch",
			transition.firstPatchAt - transition.startedAt,
			transition.id,
		);
	}

	/** An ordered marker after the first target transcript patch, not an idle-state proxy. */
	transcriptPatchScript(): string | undefined {
		const transition = this.getTransition(this.currentTransitionId());
		if (
			!transition?.transcriptProjected ||
			transition.firstPatchAt !== undefined ||
			transition.generation === undefined
		)
			return undefined;
		return `window.piUi.sessionPerformance.transcriptPatched(${transition.generation},${JSON.stringify(this.runId)})`;
	}

	recordClientTransitionPaint(metrics: ClientTransitionMetrics): void {
		if (!this.enabled) return;
		const record = {
			type: "pi-ui-session-client-performance" as const,
			schemaVersion: 2,
			transition: metrics,
		};
		appendSessionPerformanceRecord(record);
		console.log(JSON.stringify(record));
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

	/** Counts generated HTML once; deliveries are separate. Bytes are not compressed wire bytes. */
	recordPatch(
		region: PatchRegion,
		html: string,
		deliveries: number,
		transitionId?: number,
	): void {
		if (!this.enabled) return;
		const bytes = Buffer.byteLength(html);
		const transition = this.getTransition(transitionId ?? this.currentTransitionId());
		for (const counters of [this.counters, ...(transition ? [transition] : [])]) {
			const patch = counters.patches[region];
			patch.count += 1;
			patch.deliveries += deliveries;
			patch.htmlBytes += bytes;
		}
	}

	private currentTransitionId(): number | undefined {
		return this.transitionContext.getStore() ?? this.activeTransitionId;
	}

	private getTransition(id: number | undefined): Transition | undefined {
		return this.enabled && id !== undefined ? this.transitions.get(id) : undefined;
	}

	private incrementCounter(
		name: Exclude<keyof PerformanceCounters, "patches">,
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

	private finishTransition(transition: Transition): void {
		const elapsedMs = performance.now() - transition.startedAt;
		this.recordSpan("sessionOpen", elapsedMs, transition.id);
		this.transitions.delete(transition.id);
		if (this.activeTransitionId === transition.id) {
			this.activeTransitionId = undefined;
		}
		const record: SessionPerformanceRecord = {
			type: "pi-ui-session-performance",
			schemaVersion: 2,
			runId: this.runId,
			transition: {
				id: transition.id,
				generation: transition.generation,
				elapsedMs,
				spans: structuredClone(transition.spans),
				logicalSessionOpenCount: transition.logicalSessionOpenCount,
				patches: structuredClone(transition.patches),
				backgroundLookupHitCount: transition.backgroundLookupHitCount,
				backgroundLookupMissCount: transition.backgroundLookupMissCount,
				ownership: structuredClone(transition.ownership),
			},
			cumulative: this.snapshot(),
		};
		appendSessionPerformanceRecord(record);
		console.log(JSON.stringify(record));
	}
}

function updateSpan(span: SpanSummary, durationMs: number): void {
	span.count += 1;
	span.totalMs += durationMs;
	span.maxMs = Math.max(span.maxMs, durationMs);
}

export const sessionPerformance = new SessionPerformanceCollector();
