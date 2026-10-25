// Measures callback intervals, not frames presented by the display.
export function createFrameSampler() {
	let previous;
	let startedAt;
	let intervals = [];
	return {
		reset() {
			previous = undefined;
			startedAt = undefined;
			intervals = [];
		},
		add(now) {
			if (previous === undefined) {
				previous = startedAt = now;
				return;
			}
			intervals.push(now - previous);
			previous = now;
			const elapsed = now - startedAt;
			if (elapsed < 1000) return;
			const sorted = intervals.sort((a, b) => a - b);
			const middle = Math.floor(sorted.length / 2);
			const result = {
				rate: (intervals.length * 1000) / elapsed,
				median:
					(sorted[middle] + sorted[Math.floor((sorted.length - 1) / 2)]) / 2,
				p95: sorted[Math.ceil(sorted.length * 0.95) - 1],
				max: sorted.at(-1),
			};
			intervals = [];
			startedAt = now;
			return result;
		},
	};
}

export function bindDebugFrames() {
	const rate = document.getElementById("debug-frame-rate");
	if (!rate) return;
	const median = document.getElementById("debug-frame-median");
	const p95 = document.getElementById("debug-frame-p95");
	const max = document.getElementById("debug-frame-max");
	const sampler = createFrameSampler();
	let frame;
	function tick(now) {
		const sample = sampler.add(now);
		if (sample) {
			rate.textContent = String(Math.round(sample.rate));
			median.textContent = sample.median.toFixed(1);
			p95.textContent = sample.p95.toFixed(1);
			max.textContent = sample.max.toFixed(1);
		}
		frame = requestAnimationFrame(tick);
	}
	function updateVisibility() {
		if (frame !== undefined) cancelAnimationFrame(frame);
		sampler.reset();
		rate.textContent = median.textContent = p95.textContent = max.textContent = "—";
		if (!document.hidden) frame = requestAnimationFrame(tick);
	}
	document.addEventListener("visibilitychange", updateVisibility);
	updateVisibility();
}
