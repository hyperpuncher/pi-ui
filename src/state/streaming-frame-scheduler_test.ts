import { StreamingFrameScheduler } from "./streaming-frame-scheduler.ts";

Deno.test("streaming scheduler is latest-wins with one queued frame", () => {
	const clock = new FakeClock();
	const rendered: string[] = [];
	const scheduler = new StreamingFrameScheduler<string>(
		(value) => rendered.push(value),
		clock,
	);

	scheduler.schedule("first");
	scheduler.schedule("second");
	scheduler.schedule("latest");
	assertEqual(clock.pending, 1);
	clock.advance(7);
	assertEqual(rendered.join(","), "latest");
	assertEqual(scheduler.stats.coalescedSnapshots, 2);
});

Deno.test("streaming scheduler does not overlap reentrant rendering", () => {
	const clock = new FakeClock();
	const rendered: number[] = [];
	let active = 0;
	let maximum = 0;
	let scheduler: StreamingFrameScheduler<number>;
	scheduler = new StreamingFrameScheduler((value) => {
		active += 1;
		maximum = Math.max(maximum, active);
		rendered.push(value);
		if (value === 1) scheduler.schedule(2);
		active -= 1;
	}, clock);

	scheduler.schedule(1);
	clock.advance(7);
	assertEqual(clock.pending, 1);
	clock.advance(7);
	assertEqual(rendered.join(","), "1,2");
	assertEqual(maximum, 1);
});

Deno.test("streaming scheduler immediately flushes completion during a slow render", () => {
	const clock = new FakeClock();
	const rendered: string[] = [];
	let scheduler: StreamingFrameScheduler<string>;
	scheduler = new StreamingFrameScheduler((value) => {
		rendered.push(value);
		if (value === "partial") {
			clock.advance(20);
			scheduler.flush("final");
		}
	}, clock);
	scheduler.schedule("partial");
	clock.advance(7);
	assertEqual(rendered.join(","), "partial,final");
	assertEqual(clock.pending, 0);
});

Deno.test("streaming scheduler flushes final content and clears replacement work", () => {
	const clock = new FakeClock();
	const rendered: string[] = [];
	const scheduler = new StreamingFrameScheduler<string>(
		(value) => rendered.push(value),
		clock,
	);

	scheduler.schedule("partial");
	scheduler.flush("final");
	assertEqual(rendered.join(","), "final");
	assertEqual(clock.pending, 0);
	scheduler.schedule("obsolete");
	scheduler.clear();
	clock.advance(100);
	assertEqual(rendered.join(","), "final");
});

Deno.test("streaming scheduler follows 60 through 240 Hz monotonic cadence", () => {
	for (const hz of [60, 75, 90, 100, 120, 144, 165, 240]) {
		const clock = new FakeClock();
		const times: number[] = [];
		const scheduler = new StreamingFrameScheduler<number>(
			() => times.push(clock.now()),
			clock,
			0,
		);
		scheduler.setDisplayHz(hz);
		for (let frame = 0; frame < 3; frame += 1) {
			scheduler.schedule(frame);
			clock.advance(1000 / hz);
		}
		assertEqual(times.length, 3);
		assertNear(times[2] - times[1], 1000 / hz, 0.001);
	}
});

class FakeClock {
	private time = 0;
	private sequence = 0;
	private timers = new Map<number, { at: number; callback: () => void }>();

	readonly now = (): number => this.time;
	readonly setTimer = (callback: () => void, delayMs: number): number => {
		const id = ++this.sequence;
		this.timers.set(id, { at: this.time + delayMs, callback });
		return id;
	};
	readonly clearTimer = (id: number): void => {
		this.timers.delete(id);
	};

	get pending(): number {
		return this.timers.size;
	}

	advance(durationMs: number): void {
		const target = this.time + durationMs;
		while (true) {
			const next = [...this.timers.entries()].toSorted(
				(left, right) => left[1].at - right[1].at,
			)[0];
			if (!next || next[1].at > target) break;
			this.time = next[1].at;
			this.timers.delete(next[0]);
			next[1].callback();
		}
		this.time = target;
	}
}

function assertEqual(actual: unknown, expected: unknown): void {
	if (!Object.is(actual, expected)) {
		throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
	}
}

function assertNear(actual: number, expected: number, tolerance: number): void {
	if (Math.abs(actual - expected) > tolerance) {
		throw new Error(`Expected ${actual} to be within ${tolerance} of ${expected}`);
	}
}
