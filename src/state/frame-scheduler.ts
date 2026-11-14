/** 30 Hz. */
export const frameIntervalMs = 1000 / 30;

/**
 * Coalesces commits into fixed 30 Hz frames. Deadlines stay on the same grid
 * after late or idle frames, so streaming output keeps an even cadence.
 */
export class FrameScheduler {
	private dirty = false;
	private rendering = false;
	private flushAfterRender = false;
	private timer: ReturnType<typeof setTimeout> | undefined;
	private nextDeadline: number | undefined;

	constructor(private readonly render: () => void) {}

	schedule(): void {
		this.dirty = true;
		if (!this.rendering) this.scheduleTimer();
	}

	/** Lifecycle boundary: commits now instead of at the next frame. */
	flush(): void {
		this.dirty = true;
		this.cancelTimer();
		if (this.rendering) this.flushAfterRender = true;
		else this.commit();
	}

	private scheduleTimer(): void {
		if (this.timer !== undefined || !this.dirty) return;
		const now = performance.now();
		this.nextDeadline ??= now + frameIntervalMs;
		if (this.nextDeadline <= now) {
			const skipped = Math.floor((now - this.nextDeadline) / frameIntervalMs) + 1;
			this.nextDeadline += skipped * frameIntervalMs;
		}
		const deadline = this.nextDeadline;
		this.timer = setTimeout(() => {
			this.timer = undefined;
			this.nextDeadline = deadline + frameIntervalMs;
			this.commit();
		}, deadline - now);
	}

	private commit(): void {
		if (!this.dirty || this.rendering) return;
		this.dirty = false;
		this.rendering = true;
		try {
			this.render();
		} finally {
			this.rendering = false;
		}
		if (this.dirty && this.flushAfterRender) {
			this.flushAfterRender = false;
			this.commit();
		} else if (this.dirty) this.scheduleTimer();
	}

	private cancelTimer(): void {
		clearTimeout(this.timer);
		this.timer = undefined;
	}
}
