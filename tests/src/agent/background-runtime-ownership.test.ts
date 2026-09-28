import { test } from "bun:test";

import {
	BackgroundRuntimeOwnership,
	RuntimeOwnershipInvariantError,
	type OwnedBackgroundRuntime,
} from "#src/agent/background-runtime-ownership.ts";
import { assertEquals, assertStrictEquals, assertThrows } from "#testing/assertions";

type FakeRuntime = OwnedBackgroundRuntime & { name: string };

test("activation rollback retains its runtime", () => {
	const { ownership, target, activation } = activateOwnedRuntime();
	activation.rollback();

	assertStrictEquals(ownership.get("A"), target);
});

test("activation commit removes its runtime exactly once", () => {
	const { ownership, target, activation } = activateOwnedRuntime();

	target.observedRunning = false;
	target.status = "completed";
	activation.commit();
	activation.commit();

	assertEquals(ownership.get("A"), undefined);
	assertEquals(ownership.invariantFailureCount, 0);
});

test("register rejects replacing an owned runtime", () => {
	const ownership = new BackgroundRuntimeOwnership<FakeRuntime>();
	const first = fakeRuntime("A", ownership.allocateGeneration());
	const replacement = fakeRuntime("B", ownership.allocateGeneration());
	ownership.register("A", first);

	assertThrows(
		() => ownership.register("A", replacement),
		RuntimeOwnershipInvariantError,
	);
	assertStrictEquals(ownership.get("A"), first);
	assertEquals(ownership.invariantFailureCount, 1);
});

function activateOwnedRuntime() {
	const ownership = new BackgroundRuntimeOwnership<FakeRuntime>();
	const target = fakeRuntime("A", ownership.allocateGeneration());
	ownership.register("A", target);
	const activation = ownership.beginActivation("A");
	if (!activation) throw new Error("missing activation");
	return { ownership, target, activation };
}

function fakeRuntime(name: string, generation: number): FakeRuntime {
	return {
		name,
		generation,
		status: "running",
		observedRunning: true,
	};
}
