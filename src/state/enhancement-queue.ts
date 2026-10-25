export type EnhancementQueueJob = {
	priority: number;
	run: (signal: AbortSignal) => Promise<void>;
	onError?: (error: ErrorOptions["cause"]) => void;
	onCancel?: () => void;
};

/** Runs presentation-only work without allowing an unbounded restore burst. */
export class EnhancementQueue {
	private readonly pending: EnhancementQueueJob[] = [];
	private readonly active = new Map<EnhancementQueueJob, AbortController>();

	constructor(private readonly concurrency = 2) {
		if (!Number.isInteger(concurrency) || concurrency < 1) {
			throw new Error("Enhancement concurrency must be a positive integer");
		}
	}

	enqueue(job: EnhancementQueueJob): void {
		this.pending.push(job);
		this.pending.sort((left, right) => right.priority - left.priority);
		this.drain();
	}

	cancelAll(): void {
		for (const job of this.pending.splice(0)) job.onCancel?.();
		for (const [job, controller] of this.active) {
			controller.abort();
			job.onCancel?.();
		}
	}

	private drain(): void {
		while (this.active.size < this.concurrency) {
			const job = this.pending.shift();
			if (!job) return;
			const controller = new AbortController();
			this.active.set(job, controller);
			void job
				.run(controller.signal)
				.catch((error: ErrorOptions["cause"]) => {
					if (!controller.signal.aborted) job.onError?.(error);
				})
				.finally(() => {
					this.active.delete(job);
					this.drain();
				});
		}
	}
}
