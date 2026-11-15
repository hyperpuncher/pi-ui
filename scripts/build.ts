import { mkdir } from "node:fs/promises";

import { serverExternals } from "./build-externals.ts";

await mkdir("dist", { recursive: true });
const result = await Bun.build({
	entrypoints: ["src/server-main.ts", "src/extensions/codemode/worker.ts"],
	root: ".",
	compile: {
		assets: ["./static"],
		outfile: "./dist/pi-ui",
	},
	external: serverExternals,
	format: "esm",
	minify: true,
	bytecode: true,
});

for (const log of result.logs) console.warn(log);
