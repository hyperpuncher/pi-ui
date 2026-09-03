import { mkdir } from "node:fs/promises";

await mkdir("dist", { recursive: true });
const result = await Bun.build({
	entrypoints: ["src/server-main.ts"],
	compile: {
		assets: ["./static"],
		outfile: "./dist/pi-ui",
	},
	external: ["@silvia-odwyer/photon-node"],
	minify: true,
	sourcemap: "linked",
});

for (const log of result.logs) console.warn(log);
