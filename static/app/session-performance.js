let pending;

export function bindSessionPerformance() {
	const transition = document.getElementById("session-transition");
	if (transition?.dataset.sessionPerformanceEnabled !== "true") return;
	const observer = new MutationObserver(readTransitionState);
	observer.observe(document.documentElement, {
		attributes: true,
		childList: true,
		attributeFilter: [
			"data-session-transition-status",
			"data-session-transition-generation",
		],
		subtree: true,
	});
}

export function startSessionPerformanceMeasurement() {
	const transition = document.getElementById("session-transition");
	if (transition?.dataset.sessionPerformanceEnabled !== "true") return;
	pending = { startedAt: performance.now() };
}

function readTransitionState() {
	if (!pending) return;
	const transition = document.getElementById("session-transition");
	if (!transition) return;
	const generation = Number(transition.dataset.sessionTransitionGeneration);
	const status = transition.dataset.sessionTransitionStatus;
	const now = performance.now();
	if (status === "loading") {
		pending.generation = generation;
		pending.loadingAt ??= now;
		return;
	}
	if (
		status !== "idle" ||
		pending.generation !== generation ||
		pending.loadingAt === undefined
	) {
		return;
	}
	const measurement = pending;
	pending = undefined;
	waitForTranscriptPaint(measurement, generation, now);
}

function waitForTranscriptPaint(measurement, generation, morphAt) {
	requestAnimationFrame(() => {
		const transition = document.getElementById("session-transition");
		const messages = document.getElementById("messages");
		if (
			transition &&
			messages &&
			getComputedStyle(transition).display === "none" &&
			getComputedStyle(messages).display !== "none"
		) {
			requestAnimationFrame(() => {
				const metrics = {
					generation,
					clickToLoadingMs: measurement.loadingAt - measurement.startedAt,
					clickToMorphMs: morphAt - measurement.startedAt,
					clickToPaintMs: performance.now() - measurement.startedAt,
				};
				document.body.dispatchEvent(
					new CustomEvent("pi-ui-session-performance", { detail: metrics }),
				);
			});
			return;
		}
		if (performance.now() - measurement.startedAt < 60_000) {
			waitForTranscriptPaint(measurement, generation, morphAt);
		}
	});
}
