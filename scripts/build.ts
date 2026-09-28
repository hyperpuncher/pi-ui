import { mkdir } from "node:fs/promises";

await mkdir("dist", { recursive: true });
const result = await Bun.build({
	entrypoints: ["src/server-main.ts"],
	compile: {
		assets: ["./static"],
		outfile: "./dist/pi-ui",
	},
	// Pi falls back to eager languages when its terminal-only catalog is absent.
	// Pierre uses the JS engine, not its optional WASM engine.
	external: ["@silvia-odwyer/photon-node", "highlight.js/lib/index.js", "shiki/wasm"],
	format: "esm",
	minify: true,
	bytecode: true,
});

for (const log of result.logs) console.warn(log);
