let pending;

export function startSessionPerformanceMeasurement() {
	const transition = document.getElementById("session-transition");
	if (!transition?.hasAttribute("data-session-performance-enabled")) return;
	pending = { startedAt: performance.now() };
}

export function readTransitionState(status, generation) {
	if (!pending) return;
	const now = performance.now();
	if (status === "loading") {
		pending.generation = Number(generation);
		pending.loadingAt ??= now;
		return;
	}
	if (
		status !== "idle" ||
		pending.generation !== Number(generation) ||
		pending.loadingAt === undefined
	) {
		return;
	}
	const measurement = pending;
	pending = undefined;
	waitForTranscriptPaint(measurement, Number(generation), now);
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
