import { afterEach, beforeEach, jest, test } from "bun:test";

import { frameIntervalMs, FrameScheduler } from "#src/state/frame-scheduler.ts";
import { assertEquals } from "#testing/assertions";

beforeEach(() => jest.useFakeTimers({ now: 0 }));
afterEach(() => jest.useRealTimers());

test("frames coalesce schedules into one render per interval", () => {
	let renders = 0;
	const frames = new FrameScheduler(() => renders++);
	frames.schedule();
	frames.schedule();
	frames.schedule();
	assertEquals(jest.getTimerCount(), 1);
	jest.advanceTimersByTime(frameIntervalMs);
	assertEquals(renders, 1);
});

test("a schedule during render waits for the next frame instead of re-entering", () => {
	let renders = 0;
	let active = 0;
	let maximum = 0;
	const frames = new FrameScheduler(() => {
		maximum = Math.max(maximum, ++active);
		if (++renders === 1) frames.schedule();
		active--;
	});
	frames.schedule();
	jest.advanceTimersByTime(frameIntervalMs);
	assertEquals(renders, 1);
	jest.advanceTimersByTime(frameIntervalMs);
	assertEquals([renders, maximum], [2, 1]);
});

test("flush renders now, and once more after a flush that arrives during render", () => {
	let renders = 0;
	const frames = new FrameScheduler(() => {
		if (++renders === 1) frames.flush();
	});
	frames.schedule();
	frames.flush();
	assertEquals(renders, 2);
	assertEquals(jest.getTimerCount(), 0);
});

test("frames stay on their interval grid after an idle gap", () => {
	const times: number[] = [];
	const frames = new FrameScheduler(() => times.push(performance.now()));
	frames.schedule();
	jest.advanceTimersByTime(frameIntervalMs * 3.5);
	frames.schedule();
	jest.advanceTimersByTime(frameIntervalMs);
	// Fake timers round delays to whole milliseconds.
	assertEquals(Math.round((times[1]! - times[0]!) / frameIntervalMs), 3);
});
