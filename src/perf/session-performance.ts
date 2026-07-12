const utf8Encoder = new TextEncoder();

// SDK 0.80.6 loads entries once for the header and again for manager state.
export const sdkInternalReadsPerSessionOpenEstimate = 2;

export const sessionPerformanceSpanNames = [
	"sessionOpen",
	"runtimeSwitchCreate",
	"extensionBind",
	"transcriptProjection",
	"firstTranscriptPatch",
	"toolEnhancement",
	"markdownEnhancement",
] as const;

export type SessionPerformanceSpanName = (typeof sessionPerformanceSpanNames)[number];

export type SessionPerformanceSnapshot = {
	enabled: boolean;
	spans: Record<
		SessionPerformanceSpanName,
		{ count: number; totalMs: number; maxMs: number }
	>;
	logicalSessionOpenCount: number;
	sdkInternalReadsPerSessionOpenEstimate: number;
	fatMorphCount: number;
	targetedMessagePatchCount: number;
	bytesRendered: number;
};

type Transition = {
	startedAt: number;
	hostComplete: boolean;
	transcriptProjected: boolean;
	firstPatchAt?: number;
};

function emptySpans(): SessionPerformanceSnapshot["spans"] {
	return Object.fromEntries(
		sessionPerformanceSpanNames.map((name) => [
			name,
			{ count: 0, totalMs: 0, maxMs: 0 },
		]),
	) as SessionPerformanceSnapshot["spans"];
}

class SessionPerformanceCollector {
	private spans = emptySpans();
	private logicalSessionOpenCount = 0;
	private fatMorphCount = 0;
	private targetedMessagePatchCount = 0;
	private bytesRendered = 0;
	private transition: Transition | undefined;

	get enabled(): boolean {
		return Deno.env.get("PI_UI_PERF") === "1";
	}

	reset(): void {
		this.spans = emptySpans();
		this.logicalSessionOpenCount = 0;
		this.fatMorphCount = 0;
		this.targetedMessagePatchCount = 0;
		this.bytesRendered = 0;
		this.transition = undefined;
	}

	snapshot(): SessionPerformanceSnapshot {
		return {
			enabled: this.enabled,
			spans: structuredClone(this.spans),
			logicalSessionOpenCount: this.logicalSessionOpenCount,
			sdkInternalReadsPerSessionOpenEstimate,
			fatMorphCount: this.fatMorphCount,
			targetedMessagePatchCount: this.targetedMessagePatchCount,
			bytesRendered: this.bytesRendered,
		};
	}

	startSpan(name: SessionPerformanceSpanName): () => void {
		if (!this.enabled) return () => {};
		const startedAt = performance.now();
		let ended = false;
		return () => {
			if (ended) return;
			ended = true;
			this.recordSpan(name, performance.now() - startedAt);
		};
	}

	async measure<T>(
		name: SessionPerformanceSpanName,
		operation: () => Promise<T>,
	): Promise<T> {
		const end = this.startSpan(name);
		try {
			return await operation();
		} finally {
			end();
		}
	}

	startSessionTransition(): void {
		if (!this.enabled) return;
		this.transition = {
			startedAt: performance.now(),
			hostComplete: false,
			transcriptProjected: false,
		};
	}

	markSessionTransitionComplete(): void {
		if (!this.enabled || !this.transition) return;
		this.transition.hostComplete = true;
		this.finishTransitionIfReady();
	}

	cancelSessionTransition(): void {
		if (!this.enabled) return;
		this.transition = undefined;
	}

	markTranscriptProjected(): void {
		if (!this.enabled || !this.transition) return;
		this.transition.transcriptProjected = true;
	}

	markFirstTranscriptPatch(): void {
		if (
			!this.enabled ||
			!this.transition?.transcriptProjected ||
			this.transition.firstPatchAt
		) {
			return;
		}
		this.transition.firstPatchAt = performance.now();
		this.recordSpan(
			"firstTranscriptPatch",
			this.transition.firstPatchAt - this.transition.startedAt,
		);
		this.finishTransitionIfReady();
	}

	recordSessionOpen(): void {
		if (!this.enabled) return;
		this.logicalSessionOpenCount += 1;
	}

	recordFatMorph(html: string): void {
		if (!this.enabled) return;
		this.fatMorphCount += 1;
		this.bytesRendered += utf8Encoder.encode(html).byteLength;
	}

	recordTargetedMessagePatch(html: string): void {
		if (!this.enabled) return;
		this.targetedMessagePatchCount += 1;
		this.bytesRendered += utf8Encoder.encode(html).byteLength;
	}

	private recordSpan(name: SessionPerformanceSpanName, durationMs: number): void {
		const span = this.spans[name];
		span.count += 1;
		span.totalMs += durationMs;
		span.maxMs = Math.max(span.maxMs, durationMs);
	}

	private finishTransitionIfReady(): void {
		const transition = this.transition;
		if (!transition?.hostComplete || transition.firstPatchAt === undefined) {
			return;
		}
		this.recordSpan("sessionOpen", performance.now() - transition.startedAt);
		this.transition = undefined;
		console.log(
			JSON.stringify({ type: "pi-ui-session-performance", ...this.snapshot() }),
		);
	}
}

export const sessionPerformance = new SessionPerformanceCollector();
