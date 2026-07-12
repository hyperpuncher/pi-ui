export type EnhancementQueueJob = {
	key: string;
	priority: number;
	run: (signal: AbortSignal) => Promise<void>;
	onError?: (error: unknown) => void;
	onCancel?: () => void;
};

type QueuedJob = EnhancementQueueJob & { sequence: number };

/** Runs presentation-only work without allowing an unbounded restore burst. */
export class EnhancementQueue {
	private readonly pending: QueuedJob[] = [];
	private readonly active = new Map<QueuedJob, AbortController>();
	private sequence = 0;

	constructor(private readonly concurrency = 2) {
		if (!Number.isInteger(concurrency) || concurrency < 1) {
			throw new Error("Enhancement concurrency must be a positive integer");
		}
	}

	enqueue(job: EnhancementQueueJob): void {
		this.pending.push({ ...job, sequence: this.sequence++ });
		this.pending.sort(
			(left, right) =>
				right.priority - left.priority || left.sequence - right.sequence,
		);
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
				.catch((error: unknown) => {
					if (!controller.signal.aborted) job.onError?.(error);
				})
				.finally(() => {
					this.active.delete(job);
					this.drain();
				});
		}
	}
}
