let pageId;
let pending;

export function startSessionPerformanceMeasurement() {
	if (!enabled()) return;
	pending = { startedAt: performance.now(), origin: "command" };
}

function enabled() {
	return document
		.getElementById("session-transition")
		?.hasAttribute("data-session-performance-enabled");
}

export function readTransitionState(status, generation) {
	if (!enabled()) return;
	if (status === "loading") {
		if (
			!pending ||
			(pending.generation !== undefined &&
				pending.generation !== Number(generation))
		) {
			pending = { startedAt: performance.now(), origin: "observer" };
		}
		pending.generation = Number(generation);
		pending.loadingObservedMs ??= performance.now() - pending.startedAt;
		return;
	}
	if (status === "error") {
		pending = undefined;
		return;
	}
	if (
		status !== "idle" ||
		pending?.generation !== Number(generation) ||
		pending.readyObservedMs !== undefined
	)
		return;
	const measurement = pending;
	measurement.readyObservedMs = performance.now() - measurement.startedAt;
	afterFrame(measurement, "readyFrameMs");
}

/** Called by an ordered SSE script after the first target transcript patch. */
export function transcriptPatched(generation, runId) {
	if (
		!enabled() ||
		!pending ||
		pending.generation !== Number(generation) ||
		pending.firstTranscriptPatchMs !== undefined
	)
		return;
	const measurement = pending;
	measurement.runId = runId;
	measurement.firstTranscriptPatchMs = performance.now() - measurement.startedAt;
	afterFrame(measurement, "firstTranscriptFrameMs");
}

function afterFrame(measurement, field) {
	// Two animation frames estimate a rendering opportunity, not a measured paint.
	requestAnimationFrame(() =>
		requestAnimationFrame(() => {
			if (pending !== measurement || document.hidden) return;
			measurement[field] = performance.now() - measurement.startedAt;
			if (
				measurement.firstTranscriptFrameMs === undefined ||
				measurement.readyFrameMs === undefined
			)
				return;
			pending = undefined;
			const { startedAt: _, ...metrics } = measurement;
			document.body.dispatchEvent(
				new CustomEvent("pi-ui-session-performance", {
					detail: {
						pageId: (pageId ??= crypto
							.getRandomValues(new Uint32Array(4))
							.join("-")),
						...metrics,
					},
				}),
			);
		}),
	);
}

if (enabled()) {
	document.addEventListener("visibilitychange", () => {
		if (document.hidden) pending = undefined;
	});
}
