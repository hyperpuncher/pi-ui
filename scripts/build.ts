import { mkdir } from "node:fs/promises";

await mkdir("dist", { recursive: true });
const result = await Bun.build({
	entrypoints: ["src/server-main.ts", "src/extensions/codemode/worker.ts"],
	root: ".",
	compile: {
		assets: ["./static"],
		outfile: "./dist/pi-ui",
	},
	// Pi falls back to eager languages when its terminal-only catalog is absent.
	external: ["@silvia-odwyer/photon-node", "highlight.js/lib/index.js"],
	format: "esm",
	minify: true,
	bytecode: true,
});

for (const log of result.logs) console.warn(log);
