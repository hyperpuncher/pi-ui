import { EnhancementQueue } from "./enhancement-queue.ts";

Deno.test("enhancement queue bounds concurrency and continues after errors", async () => {
	const queue = new EnhancementQueue(2);
	let active = 0;
	let maximum = 0;
	let errors = 0;
	const releases: Array<() => void> = [];
	const completed: number[] = [];

	for (let index = 0; index < 5; index += 1) {
		queue.enqueue({
			key: String(index),
			priority: index,
			run: async () => {
				active += 1;
				maximum = Math.max(maximum, active);
				await new Promise<void>((resolve) => releases.push(resolve));
				active -= 1;
				if (index === 1) throw new Error("expected");
				completed.push(index);
			},
			onError: () => (errors += 1),
		});
	}

	while (releases.length < 2) await Promise.resolve();
	while (releases.length > 0 || completed.length + errors < 5) {
		releases.shift()?.();
		await Promise.resolve();
		await Promise.resolve();
	}
	assertEqual(maximum, 2);
	assertEqual(errors, 1);
	assertEqual(completed.length, 4);
});

Deno.test("enhancement queue cancels pending and active jobs", async () => {
	const queue = new EnhancementQueue(1);
	let release: (() => void) | undefined;
	let cancelled = 0;
	let secondRan = false;
	queue.enqueue({
		key: "active",
		priority: 0,
		run: (signal) =>
			new Promise<void>((resolve) => {
				release = () => {
					if (!signal.aborted) throw new Error("Active job was not aborted");
					resolve();
				};
			}),
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
	release?.();
	await Promise.resolve();
	await Promise.resolve();
	assertEqual(cancelled, 2);
	assertEqual(secondRan, false);
});

function assertEqual(actual: unknown, expected: unknown): void {
	if (!Object.is(actual, expected)) {
		throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
	}
}
