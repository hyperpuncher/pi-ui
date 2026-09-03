import { chmod, mkdir, rm } from "node:fs/promises";

const outputRoot = "dist/npm";
const executable = `${outputRoot}/server-main.js`;

await rm(outputRoot, { recursive: true, force: true });
await mkdir(outputRoot, { recursive: true });
const result = await Bun.build({
	entrypoints: ["src/server-main.ts"],
	outdir: outputRoot,
	target: "bun",
	format: "esm",
	packages: "bundle",
	// pi-ui replaces pi's Photon image processing with Bun.Image.
	external: ["@silvia-odwyer/photon-node"],
	minify: true,
	// Let runtime-loaded pi extensions import the core modules embedded above.
	define: { PI_BUNDLED_NODE: "true" },
	banner: "#!/usr/bin/env bun",
});
for (const log of result.logs) console.warn(log);
await chmod(executable, 0o755);
