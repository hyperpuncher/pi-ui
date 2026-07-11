import { BoundedCache, deleteStringKeysWithPrefix } from "./render-cache.ts";

Deno.test("BoundedCache validates its capacity", () => {
	for (const capacity of [0, -1, 1.5]) {
		assertThrows(() => new BoundedCache(capacity));
	}
});

Deno.test("BoundedCache replaces values and refreshes recency", () => {
	const cache = new BoundedCache<string, number>(2);
	cache.set("a", 1);
	cache.set("b", 2);
	cache.set("a", 3);
	cache.set("c", 4);
	assertEqual(cache.size, 2);
	assertEqual(cache.get("a"), 3);
	assertEqual(cache.get("b"), undefined);
	assertEqual(cache.get("c"), 4);
});

Deno.test("BoundedCache evicts, deletes, and clears entries", () => {
	const cache = new BoundedCache<string, number>(2);
	cache.set("a", 1);
	cache.set("b", 2);
	cache.set("c", 3);
	assertEqual(cache.get("a"), undefined);
	assertEqual(cache.delete("b"), true);
	assertEqual(cache.size, 1);
	cache.clear();
	assertEqual(cache.size, 0);
});

Deno.test("deleteStringKeysWithPrefix only removes one message's state", () => {
	const states = new Map([
		["message-1:0", 1],
		["message-1:1", 2],
		["message-10:0", 3],
		["message-2:0", 4],
	]);
	deleteStringKeysWithPrefix(states, "message-1:");
	assertEqual([...states.keys()].join(","), "message-10:0,message-2:0");
});

function assertEqual(actual: unknown, expected: unknown): void {
	if (!Object.is(actual, expected)) {
		throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
	}
}

function assertThrows(callback: () => unknown): void {
	try {
		callback();
	} catch {
		return;
	}
	throw new Error("Expected callback to throw");
}
