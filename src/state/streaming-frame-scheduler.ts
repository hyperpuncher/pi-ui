export const fallbackDisplayHz = 144;
export const minimumDisplayHz = 30;
export const maximumDisplayHz = 240;

export type StreamingFrameSchedulerClock = {
	now: () => number;
	setTimer: (callback: () => void, delayMs: number) => number;
	clearTimer: (id: number) => void;
};

export type StreamingFrameSchedulerStats = {
	committedFrames: number;
	coalescedSnapshots: number;
};

const defaultClock: StreamingFrameSchedulerClock = {
	now: () => performance.now(),
	setTimer: (callback, delayMs) => Number(setTimeout(callback, delayMs)),
	clearTimer: (id) => clearTimeout(id),
};

/** Keeps only the newest authoritative snapshot and commits at monotonic deadlines. */
export class StreamingFrameScheduler<T> {
	private latest: T | undefined;
	private dirty = false;
	private rendering = false;
	private flushAfterRender = false;
	private timer: number | undefined;
	private nextDeadline: number | undefined;
	private intervalMs = 1000 / fallbackDisplayHz;
	private committedFrames = 0;
	private coalescedSnapshots = 0;

	constructor(
		private readonly render: (snapshot: T) => void,
		private readonly clock: StreamingFrameSchedulerClock = defaultClock,
		private readonly schedulingToleranceMs = 0.5,
	) {}

	get targetIntervalMs(): number {
		return this.intervalMs;
	}

	get stats(): StreamingFrameSchedulerStats {
		return {
			committedFrames: this.committedFrames,
			coalescedSnapshots: this.coalescedSnapshots,
		};
	}

	setDisplayHz(hz: number): boolean {
		if (!Number.isFinite(hz)) return false;
		const clamped = Math.min(maximumDisplayHz, Math.max(minimumDisplayHz, hz));
		const intervalMs = 1000 / clamped;
		if (Math.abs(intervalMs - this.intervalMs) < 0.01) return false;
		this.intervalMs = intervalMs;
		this.nextDeadline = this.clock.now() + intervalMs;
		this.cancelTimer();
		if (this.dirty && !this.rendering) this.scheduleTimer();
		return true;
	}

	schedule(snapshot: T): void {
		if (this.dirty) this.coalescedSnapshots += 1;
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
		while (this.nextDeadline <= now) this.nextDeadline += this.intervalMs;
		const delay = Math.max(0, this.nextDeadline - now - this.schedulingToleranceMs);
		this.timer = this.clock.setTimer(() => {
			this.timer = undefined;
			this.nextDeadline = (this.nextDeadline ?? this.clock.now()) + this.intervalMs;
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
			this.committedFrames += 1;
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
