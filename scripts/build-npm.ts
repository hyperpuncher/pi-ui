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
	packages: "external",
	minify: true,
	banner: "#!/usr/bin/env bun",
});
if (!result.success) {
	for (const log of result.logs) console.error(log);
	process.exit(1);
}
await chmod(executable, 0o755);
