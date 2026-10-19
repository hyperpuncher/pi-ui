import { onTestFinished, test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { VERSION } from "#pi/config.js";
import { assertEquals } from "#testing/assertions";
import { makeTempDir } from "#testing/temp";

test("bundled SDK keeps its own version for catalog requests", async () => {
	const outdir = await makeTempDir();
	onTestFinished(() => rm(outdir, { recursive: true, force: true }));
	const result = await Bun.build({
		entrypoints: [fileURLToPath(import.meta.resolve("#pi/config.js"))],
		outdir,
		target: "bun",
	});
	assertEquals(result.success, true);
	const process = Bun.spawn([
		"bun",
		"-e",
		`import { VERSION } from ${JSON.stringify(join(outdir, "config.js"))}; console.log(VERSION)`,
	]);
	assertEquals(await process.exited, 0);
	assertEquals((await new Response(process.stdout).text()).trim(), VERSION);
});
