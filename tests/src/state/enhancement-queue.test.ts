import { expect, test } from "bun:test";

import { EnhancementQueue } from "#src/state/enhancement-queue.ts";

test("enhancement queue bounds concurrency and continues after errors", async () => {
	const queue = new EnhancementQueue(2);
	const release = Promise.withResolvers<void>();
	const finished = Array.from({ length: 5 }, () => Promise.withResolvers<void>());
	let active = 0;
	let maximum = 0;
	let errors = 0;
	const completed: number[] = [];

	for (let index = 0; index < finished.length; index += 1) {
		queue.enqueue({
			key: String(index),
			priority: index,
			run: async () => {
				active += 1;
				maximum = Math.max(maximum, active);
				await release.promise;
				active -= 1;
				if (index === 1) throw new Error("expected");
				completed.push(index);
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
	expect(completed.toSorted()).toEqual([0, 2, 3, 4]);
});

test("enhancement queue cancels pending and active jobs", async () => {
	const queue = new EnhancementQueue(1);
	const release = Promise.withResolvers<void>();
	let activeSignal: AbortSignal | undefined;
	let cancelled = 0;
	let secondRan = false;
	queue.enqueue({
		key: "active",
		priority: 0,
		run: async (signal) => {
			activeSignal = signal;
			await release.promise;
		},
		onCancel: () => (cancelled += 1),
	});
	queue.enqueue({
		key: "pending",
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
