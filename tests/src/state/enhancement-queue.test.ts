import { expect, test } from "bun:test";

import { EnhancementQueue } from "#src/state/enhancement-queue.ts";

test("enhancement queue bounds concurrency and prioritizes pending work after errors", async () => {
	const queue = new EnhancementQueue(2);
	const release = Promise.withResolvers<void>();
	const finished = Array.from({ length: 5 }, () => Promise.withResolvers<void>());
	let active = 0;
	let maximum = 0;
	let errors = 0;
	const started: number[] = [];

	for (let index = 0; index < finished.length; index += 1) {
		queue.enqueue({
			priority: index,
			run: async () => {
				started.push(index);
				active += 1;
				maximum = Math.max(maximum, active);
				await release.promise;
				active -= 1;
				if (index === 1) throw new Error("expected");
				finished[index].resolve();
			},
			onError: () => {
				errors += 1;
				finished[index].resolve();
			},
		});
	}

	expect(active).toBe(2);
	release.resolve();
	await Promise.all(finished.map(({ promise }) => promise));
	expect(maximum).toBe(2);
	expect(errors).toBe(1);
	expect(started).toEqual([0, 1, 4, 3, 2]);
});

test("enhancement queue cancels pending and active jobs", async () => {
	const queue = new EnhancementQueue(1);
	const release = Promise.withResolvers<void>();
	let activeSignal: AbortSignal | undefined;
	let cancelled = 0;
	let secondRan = false;
	queue.enqueue({
		priority: 0,
		run: async (signal) => {
			activeSignal = signal;
			await release.promise;
		},
		onCancel: () => (cancelled += 1),
	});
	queue.enqueue({
		priority: 1,
		run: async () => {
			secondRan = true;
		},
		onCancel: () => (cancelled += 1),
	});

	queue.cancelAll();
	expect(activeSignal?.aborted).toBe(true);
	release.resolve();
	await Bun.sleep(0);
	expect(cancelled).toBe(2);
	expect(secondRan).toBe(false);
});
