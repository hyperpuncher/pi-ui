import { assertEquals } from "@std/assert";

import { collectAddedElementRoots } from "./mutation-roots.js";

Deno.test("mutation roots contain only minimal affected element subtrees", () => {
	const child = element();
	const parent = element([child]);
	const sibling = element();
	const roots = collectAddedElementRoots([
		{ addedNodes: [{ nodeType: 3 }, child] },
		{ addedNodes: [parent, sibling] },
	]);
	assertEquals(roots, [parent, sibling]);
});

function element(descendants: unknown[] = []) {
	const value = {
		nodeType: 1,
		contains(candidate: unknown) {
			return descendants.includes(candidate);
		},
	};
	return value;
}
