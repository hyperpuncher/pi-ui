import { assertEquals } from "@std/assert";

import { createDisplayRefreshMonitor, estimateDisplayHz } from "./display-refresh.js";

Deno.test("RAF samples classify common 60 through 240 Hz displays", () => {
	for (const hz of [60, 75, 90, 100, 120, 144, 165, 240]) {
		assertEquals(estimateDisplayHz(timestamps(hz, 60)), hz);
	}
});

Deno.test("RAF estimator ignores warm-up and throttled outliers", () => {
	const samples = timestamps(144, 60);
	samples[1] += 80;
	for (let index = 2; index < samples.length; index += 1) samples[index] += 80;
	samples[20] += 100;
	for (let index = 21; index < samples.length; index += 1) samples[index] += 100;
	assertEquals(estimateDisplayHz(samples), 144);
});

Deno.test("variable RAF samples choose a stable recent upper presentation rate", () => {
	const samples = [0];
	for (let index = 1; index < 60; index += 1) {
		const hz = index % 3 === 0 ? 90 : 120;
		samples.push(samples.at(-1)! + 1000 / hz);
	}
	assertEquals(estimateDisplayHz(samples), 120);
});

Deno.test("hidden samples do not overwrite the last good display rate", () => {
	let eligible = true;
	let now = 0;
	let frameCallback: ((timestamp: number) => void) | undefined;
	let timerCallback: (() => void) | undefined;
	const sent: number[] = [];
	const monitor = createDisplayRefreshMonitor({
		sampleFrames: 12,
		isEligible: () => eligible,
		requestFrame: (callback: (timestamp: number) => void) => {
			frameCallback = callback;
			return 1;
		},
		cancelFrame: () => {
			frameCallback = undefined;
		},
		setTimer: (callback: () => void) => {
			timerCallback = callback;
			return 1;
		},
		clearTimer: () => {
			timerCallback = undefined;
		},
		send: (hz: number) => sent.push(hz),
	});
	const runFrames = (hz: number) => {
		for (let index = 0; index < 12; index += 1) {
			now += 1000 / hz;
			const callback = frameCallback;
			callback?.(now);
		}
		timerCallback?.();
	};
	monitor.restart();
	runFrames(60);
	assertEquals(sent, [60]);

	eligible = false;
	monitor.restart();
	// A stale callback, if delivered by a test/browser race, is ignored while hidden.
	frameCallback?.(now + 1000 / 240);
	timerCallback?.();
	assertEquals(sent, [60]);

	eligible = true;
	monitor.restart();
	runFrames(120);
	assertEquals(sent, [60, 120]);
	monitor.restart();
	runFrames(120);
	assertEquals(sent, [60, 120]);
});

function timestamps(hz: number, count: number): number[] {
	return Array.from({ length: count }, (_, index) => (index * 1000) / hz);
}
