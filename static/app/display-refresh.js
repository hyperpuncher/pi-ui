export const COMMON_DISPLAY_RATES = [60, 75, 90, 100, 120, 144, 165, 240];
export const DISPLAY_HZ_MIN = 30;
export const DISPLAY_HZ_MAX = 240;

const WARMUP_FRAMES = 6;
const SAMPLE_FRAMES = 48;
const UPDATE_DEBOUNCE_MS = 250;

/** Robustly estimates fixed refresh and uses a stable upper rate for variable refresh. */
export function estimateDisplayHz(timestamps) {
	if (timestamps.length < WARMUP_FRAMES + 3) return undefined;
	const samples = timestamps.slice(WARMUP_FRAMES);
	const deltas = [];
	for (let index = 1; index < samples.length; index += 1) {
		const delta = samples[index] - samples[index - 1];
		if (delta >= 1000 / DISPLAY_HZ_MAX - 0.5 && delta <= 1000 / DISPLAY_HZ_MIN) {
			deltas.push(delta);
		}
	}
	if (deltas.length < 3) return undefined;
	const medianDelta = percentile(deltas, 0.5);
	const deviations = deltas.map((delta) => Math.abs(delta - medianDelta));
	const variable = percentile(deviations, 0.5) / medianDelta > 0.06;
	const presentationDelta = variable ? percentile(deltas, 0.25) : medianDelta;
	const measured = clamp(1000 / presentationDelta, DISPLAY_HZ_MIN, DISPLAY_HZ_MAX);
	return classifyCommonRate(measured);
}

export function classifyCommonRate(measuredHz) {
	const nearest = COMMON_DISPLAY_RATES.reduce((best, rate) =>
		Math.abs(rate - measuredHz) < Math.abs(best - measuredHz) ? rate : best,
	);
	return Math.abs(nearest - measuredHz) / nearest <= 0.08
		? nearest
		: Math.round(clamp(measuredHz, DISPLAY_HZ_MIN, DISPLAY_HZ_MAX));
}

export function createDisplayRefreshMonitor(options) {
	const sampleFrames = options.sampleFrames ?? SAMPLE_FRAMES;
	let frame;
	let updateTimer;
	let timestamps = [];
	let lastSentHz;
	let pendingHz;

	const sample = (timestamp) => {
		frame = undefined;
		if (!options.isEligible()) return;
		timestamps.push(timestamp);
		if (timestamps.length >= sampleFrames) {
			const hz = estimateDisplayHz(timestamps);
			timestamps = [];
			if (hz !== undefined) queueUpdate(hz);
			return;
		}
		frame = options.requestFrame(sample);
	};

	const queueUpdate = (hz) => {
		if (
			lastSentHz !== undefined &&
			(Math.abs(lastSentHz - hz) < 1 ||
				Math.abs(lastSentHz - hz) / lastSentHz < 0.02)
		) {
			return;
		}
		pendingHz = hz;
		if (updateTimer !== undefined) options.clearTimer(updateTimer);
		updateTimer = options.setTimer(() => {
			updateTimer = undefined;
			if (!options.isEligible() || pendingHz === undefined) return;
			lastSentHz = pendingHz;
			options.send(pendingHz);
			pendingHz = undefined;
		}, UPDATE_DEBOUNCE_MS);
	};

	const restart = () => {
		if (frame !== undefined) options.cancelFrame(frame);
		frame = undefined;
		timestamps = [];
		if (options.isEligible()) frame = options.requestFrame(sample);
	};

	const stop = () => {
		if (frame !== undefined) options.cancelFrame(frame);
		if (updateTimer !== undefined) options.clearTimer(updateTimer);
		frame = undefined;
		updateTimer = undefined;
		timestamps = [];
		pendingHz = undefined;
	};

	return { restart, stop };
}

export function bindDisplayRefreshMeasurement() {
	const monitor = createDisplayRefreshMonitor({
		requestFrame: (callback) => requestAnimationFrame(callback),
		cancelFrame: (id) => cancelAnimationFrame(id),
		isEligible: () => document.visibilityState === "visible" && document.hasFocus(),
		setTimer: (callback, delay) => setTimeout(callback, delay),
		clearTimer: (id) => clearTimeout(id),
		send: (hz) => {
			void fetch(document.body.dataset.displayRefreshEndpoint, {
				method: "POST",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({ hz }),
			}).catch(() => undefined);
		},
	});
	monitor.restart();
	document.addEventListener("visibilitychange", monitor.restart);
	window.addEventListener("focus", monitor.restart);
	window.addEventListener("pagehide", monitor.stop, { once: true });
}

function percentile(values, fraction) {
	const sorted = [...values].sort((left, right) => left - right);
	return sorted[
		Math.min(sorted.length - 1, Math.floor((sorted.length - 1) * fraction))
	];
}

function clamp(value, minimum, maximum) {
	return Math.min(maximum, Math.max(minimum, value));
}
