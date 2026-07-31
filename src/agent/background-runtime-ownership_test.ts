import { assertEquals, assertStrictEquals, assertThrows } from "@std/assert";

import {
	BackgroundRuntimeOwnership,
	RuntimeOwnershipInvariantError,
	type OwnedBackgroundRuntime,
} from "./background-runtime-ownership.ts";

type FakeRuntime = OwnedBackgroundRuntime & { name: string };

Deno.test("activation rollback retains its runtime", () => {
	const ownership = new BackgroundRuntimeOwnership<FakeRuntime>();
	const target = fakeRuntime("A", ownership.allocateGeneration());
	ownership.register("A", target);

	const activation = ownership.beginActivation("A");
	if (!activation) throw new Error("missing activation");
	activation.rollback();

	assertStrictEquals(ownership.get("A"), target);
});

Deno.test("activation commit removes its runtime exactly once", () => {
	const ownership = new BackgroundRuntimeOwnership<FakeRuntime>();
	const target = fakeRuntime("A", ownership.allocateGeneration());
	ownership.register("A", target);
	const activation = ownership.beginActivation("A");
	if (!activation) throw new Error("missing activation");

	target.observedRunning = false;
	target.status = "completed";
	activation.commit();
	activation.commit();

	assertEquals(ownership.get("A"), undefined);
	assertEquals(ownership.invariantFailureCount, 0);
});

Deno.test("register rejects replacing an owned runtime", () => {
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

function fakeRuntime(name: string, generation: number): FakeRuntime {
	return {
		name,
		generation,
		status: "running",
		observedRunning: true,
	};
}
