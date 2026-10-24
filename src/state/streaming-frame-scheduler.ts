export type StreamingFrameSchedulerClock = {
	now: () => number;
	setTimer: (callback: () => void, delayMs: number) => number;
	clearTimer: (id: number) => void;
};

const defaultClock: StreamingFrameSchedulerClock = {
	now: () => performance.now(),
	setTimer: (callback, delayMs) => Number(setTimeout(callback, delayMs)),
	clearTimer: (id) => clearTimeout(id),
};

/** 30 Hz. */
export const streamingIntervalMs = 1000 / 30;

/** Keeps only the newest authoritative snapshot and commits at monotonic deadlines. */
export class StreamingFrameScheduler<T> {
	private latest: T | undefined;
	private dirty = false;
	private rendering = false;
	private flushAfterRender = false;
	private timer: number | undefined;
	private nextDeadline: number | undefined;
	private readonly intervalMs = streamingIntervalMs;

	constructor(
		private readonly render: (snapshot: T) => void,
		private readonly clock: StreamingFrameSchedulerClock = defaultClock,
		private readonly schedulingToleranceMs = 0.5,
	) {}

	schedule(snapshot: T): void {
		this.latest = snapshot;
		this.dirty = true;
		if (!this.rendering) this.scheduleTimer();
	}

	/** Lifecycle boundary: synchronously commits the newest snapshot when possible. */
	flush(snapshot?: T): void {
		if (snapshot !== undefined) {
			this.latest = snapshot;
			this.dirty = true;
		}
		this.cancelTimer();
		if (this.rendering) {
			this.flushAfterRender = true;
			return;
		}
		this.commitLatest();
	}

	clear(): void {
		this.cancelTimer();
		this.latest = undefined;
		this.dirty = false;
		this.flushAfterRender = false;
		this.nextDeadline = undefined;
	}

	private scheduleTimer(): void {
		if (this.timer !== undefined || !this.dirty) return;
		const now = this.clock.now();
		if (this.nextDeadline === undefined) this.nextDeadline = now + this.intervalMs;
		if (this.nextDeadline <= now) {
			const skipped = Math.floor((now - this.nextDeadline) / this.intervalMs) + 1;
			this.nextDeadline += skipped * this.intervalMs;
		}
		const deadline = this.nextDeadline;
		const delay = Math.max(0, deadline - now - this.schedulingToleranceMs);
		this.timer = this.clock.setTimer(() => {
			this.timer = undefined;
			this.nextDeadline = deadline + this.intervalMs;
			this.commitLatest();
		}, delay);
	}

	private commitLatest(): void {
		if (!this.dirty || this.latest === undefined || this.rendering) return;
		const snapshot = this.latest;
		this.dirty = false;
		this.rendering = true;
		try {
			this.render(snapshot);
		} finally {
			this.rendering = false;
		}
		if (this.dirty && this.flushAfterRender) {
			this.flushAfterRender = false;
			this.commitLatest();
			return;
		}
		if (this.dirty) this.scheduleTimer();
	}

	private cancelTimer(): void {
		if (this.timer === undefined) return;
		this.clock.clearTimer(this.timer);
		this.timer = undefined;
	}
}
