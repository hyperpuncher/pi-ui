import { test } from "bun:test";

import {
	BackgroundRuntimeOwnership,
	type OwnedBackgroundRuntime,
	RuntimeOwnershipInvariantError,
} from "#src/agent/background-runtime-ownership.ts";
import { assertEquals, assertStrictEquals, assertThrows } from "#testing/assertions";

type FakeRuntime = OwnedBackgroundRuntime & { name: string };

test("release rejects a changed runtime owner", () => {
	const { ownership, target } = ownedRuntime();
	const replacement = fakeRuntime("B", ownership.allocateGeneration());
	ownership.delete("A");
	ownership.register("A", replacement);

	assertThrows(() => ownership.release("A", target), RuntimeOwnershipInvariantError);
	assertStrictEquals(ownership.get("A"), replacement);
	assertEquals(ownership.invariantFailureCount, 1);
});

test("release removes its owned runtime", () => {
	const { ownership, target } = ownedRuntime();
	ownership.release("A", target);

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

function ownedRuntime() {
	const ownership = new BackgroundRuntimeOwnership<FakeRuntime>();
	const target = fakeRuntime("A", ownership.allocateGeneration());
	ownership.register("A", target);
	return { ownership, target };
}

function fakeRuntime(name: string, generation: number): FakeRuntime {
	return {
		name,
		generation,
		status: "running",
		observedRunning: true,
	};
}
