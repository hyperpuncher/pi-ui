import {
	BackgroundRuntimeOwnership,
	ownsForegroundRuntime,
	RuntimeOwnershipInvariantError,
	type OwnedBackgroundRuntime,
} from "./background-runtime-ownership.ts";

type FakeRuntime = OwnedBackgroundRuntime & {
	name: string;
	events: string[];
	disposeCount: number;
	unsubscribeCount: number;
};

Deno.test("repeated A-B-A-B-A handoffs retain one live generation and delta ownership", () => {
	const harness = ownershipHarness();
	const a = harness.create("A");
	const b = harness.create("B");
	harness.foreground = a;
	harness.emit("agent_start");

	harness.activate(b);
	assertEquals(harness.background.get("A"), a);
	harness.activate(a);
	assertEquals(harness.foreground.generation, a.generation);

	// The observed lifecycle remains authoritative while an SDK could report idle.
	harness.activate(b, { sdkStreaming: false });
	assertEquals(harness.background.get("A"), a);
	harness.activate(a);
	harness.emit("delta", "continued");
	harness.emit("prompt", "next");
	harness.emit("tool", "bash");
	harness.emit("queue", "follow-up");
	harness.emit("abort");

	assertEquals(harness.foreground, a);
	assertEquals(a.events, [
		"delta:continued",
		"prompt:next",
		"tool:bash",
		"queue:follow-up",
		"abort",
	]);
	assertEquals(harness.created, 2);
	assertEquals(harness.background.liveCount(true), 2);
	assertEquals(harness.background.invariantFailureCount, 0);
});

Deno.test("delayed disposal callback cannot unsubscribe a replacement runtime", async () => {
	const first = { name: "first" };
	const replacement = { name: "replacement" };
	let current = first;
	let activeSubscription = "first";
	let releaseShutdown = () => {};
	const shutdown = new Promise<void>((resolve) => (releaseShutdown = resolve));
	const delayedDispose = (async () => {
		await shutdown;
		if (ownsForegroundRuntime(current, first)) activeSubscription = "none";
	})();

	current = replacement;
	activeSubscription = "replacement";
	releaseShutdown();
	await delayedDispose;

	assertEquals(activeSubscription, "replacement");
});

Deno.test("current runtime shutdown still detaches its own subscription", () => {
	const current = { name: "current" };
	assertEquals(ownsForegroundRuntime(current, current), true);
	assertEquals(ownsForegroundRuntime(current, { name: "other" }), false);
});

Deno.test("activation rollback retains the target and transfers no subscription", () => {
	const ownership = new BackgroundRuntimeOwnership<FakeRuntime>();
	const target = fakeRuntime("A", ownership.allocateGeneration());
	ownership.register("A", target);
	const activation = ownership.beginActivation("A")!;
	activation.rollback();

	assertEquals(ownership.get("A"), target);
	assertEquals(target.unsubscribeCount, 0);
});

Deno.test("completion races remain activatable and commit exactly once", () => {
	const ownership = new BackgroundRuntimeOwnership<FakeRuntime>();
	const target = fakeRuntime("A", ownership.allocateGeneration());
	ownership.register("A", target);
	const activation = ownership.beginActivation("A")!;
	target.observedRunning = false;
	target.status = "completed";
	activation.commit();
	activation.commit();

	assertEquals(ownership.get("A"), undefined);
	assertEquals(ownership.invariantFailureCount, 0);
});

Deno.test("duplicate generations fail without replacing the owned runtime", () => {
	const ownership = new BackgroundRuntimeOwnership<FakeRuntime>();
	const first = fakeRuntime("A", ownership.allocateGeneration());
	const duplicate = fakeRuntime("A2", ownership.allocateGeneration());
	ownership.register("A", first);
	assertThrows(() => ownership.register("A", duplicate));

	assertEquals(ownership.get("A"), first);
	assertEquals(ownership.invariantFailureCount, 1);
});

Deno.test("delete and process disposal release completed and running runtimes once", () => {
	const ownership = new BackgroundRuntimeOwnership<FakeRuntime>();
	const running = fakeRuntime("A", ownership.allocateGeneration());
	const completed = fakeRuntime("B", ownership.allocateGeneration());
	completed.status = "completed";
	completed.observedRunning = false;
	ownership.register("A", running);
	ownership.register("B", completed);

	const deleted = ownership.get("B")!;
	deleted.disposeCount += 1;
	ownership.delete("B");
	for (const runtime of ownership.values()) runtime.disposeCount += 1;
	ownership.clear();

	assertEquals(running.disposeCount, 1);
	assertEquals(completed.disposeCount, 1);
	assertEquals(ownership.size, 0);
});

function ownershipHarness() {
	const background = new BackgroundRuntimeOwnership<FakeRuntime>();
	let foreground = fakeRuntime("initial", 0);
	let created = 0;
	return {
		background,
		get foreground() {
			return foreground;
		},
		set foreground(runtime: FakeRuntime) {
			foreground = runtime;
		},
		get created() {
			return created;
		},
		create(name: string) {
			created += 1;
			return fakeRuntime(name, background.allocateGeneration());
		},
		emit(
			type:
				| "agent_start"
				| "agent_end"
				| "delta"
				| "prompt"
				| "tool"
				| "queue"
				| "abort",
			value = "",
		) {
			if (type === "agent_start") foreground.observedRunning = true;
			if (type === "agent_end") {
				foreground.observedRunning = false;
				foreground.status = "completed";
			}
			if (["delta", "prompt", "tool", "queue"].includes(type)) {
				foreground.events.push(`${type}:${value}`);
			}
			if (type === "abort") foreground.events.push(type);
		},
		activate(target: FakeRuntime, options: { sdkStreaming?: boolean } = {}) {
			if (foreground.name !== "initial") {
				const active =
					(options.sdkStreaming ?? foreground.observedRunning) ||
					foreground.observedRunning;
				if (active) background.register(foreground.name, foreground);
				else foreground.disposeCount += 1;
			}
			const transaction = background.beginActivation(target.name);
			if (transaction) {
				transaction.runtime.unsubscribeCount += 1;
				foreground = transaction.runtime;
				transaction.commit();
			} else {
				foreground = target;
			}
		},
	};
}

function fakeRuntime(name: string, generation: number): FakeRuntime {
	return {
		name,
		generation,
		status: "running",
		observedRunning: true,
		events: [],
		disposeCount: 0,
		unsubscribeCount: 0,
	};
}

function assertEquals(actual: unknown, expected: unknown): void {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(
			`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
		);
	}
}

function assertThrows(operation: () => void): void {
	try {
		operation();
	} catch (error) {
		if (error instanceof RuntimeOwnershipInvariantError) return;
		throw error;
	}
	throw new Error("Expected operation to throw");
}
