import { test } from "bun:test";

import { createFrameSampler } from "#static/app/debug-frames.js";
import { assertEquals } from "#testing/assertions";

test("frame sampler excludes the initial callback and uses elapsed time", () => {
	const sampler = createFrameSampler();
	assertEquals(sampler.add(500), undefined);
	for (let now = 510; now < 1500; now += 10) sampler.add(now);
	assertEquals(sampler.add(1500), { rate: 100, median: 10, p95: 10, max: 10 });
	for (let now = 1510; now < 2500; now += 10) sampler.add(now);
	assertEquals(sampler.add(2500), { rate: 100, median: 10, p95: 10, max: 10 });
});

test("frame sampler keeps a stall visible instead of smoothing it away", () => {
	const sampler = createFrameSampler();
	sampler.add(0);
	for (let now = 10; now <= 900; now += 10) sampler.add(now);
	assertEquals(sampler.add(1100), {
		rate: (91 * 1000) / 1100,
		median: 10,
		p95: 10,
		max: 200,
	});
});

test("frame sampler reports the median and upper percentile of varied intervals", () => {
	const sampler = createFrameSampler();
	for (const now of [0, 100, 300, 600]) sampler.add(now);
	assertEquals(sampler.add(1000), { rate: 4, median: 250, p95: 400, max: 400 });
});

test("frame sampler reset excludes time spent in a hidden tab", () => {
	const sampler = createFrameSampler();
	sampler.add(0);
	sampler.add(10);
	sampler.reset();
	assertEquals(sampler.add(100000), undefined);
	assertEquals(sampler.add(101000), { rate: 1, median: 1000, p95: 1000, max: 1000 });
});
