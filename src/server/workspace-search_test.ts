import * as path from "node:path";

import { assertEquals } from "@std/assert";

import { searchWorkspaces } from "./workspace-search.ts";

Deno.test("workspace search completes matching directories", async () => {
	const root = await Deno.makeTempDir();
	try {
		await Deno.mkdir(path.join(root, "alpha"));
		await Deno.mkdir(path.join(root, "alpine"));
		await Deno.mkdir(path.join(root, "beta"));
		await Deno.mkdir(path.join(root, ".hidden"));
		await Deno.writeTextFile(path.join(root, "alphabet.txt"), "");

		assertEquals(await searchWorkspaces(root, path.join(root, "alp")), [
			{ path: path.join(root, "alpha") },
			{ path: path.join(root, "alpine") },
		]);
		assertEquals(await searchWorkspaces(root, path.join(root, ".h")), [
			{ path: path.join(root, ".hidden") },
		]);
	} finally {
		await Deno.remove(root, { recursive: true });
	}
});

Deno.test("workspace search resolves relative paths from the active workspace", async () => {
	const root = await Deno.makeTempDir();
	try {
		await Deno.mkdir(path.join(root, "projects"));
		await Deno.mkdir(path.join(root, "projects", "pi-ui"));

		assertEquals(await searchWorkspaces(root, "projects/pi"), [
			{ path: path.join(root, "projects", "pi-ui") },
		]);
	} finally {
		await Deno.remove(root, { recursive: true });
	}
});
