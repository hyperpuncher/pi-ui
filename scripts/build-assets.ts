import { rm } from "node:fs/promises";

const themeLab = process.env.PI_UI_THEME_LAB === "1";
const pierreWorker = Bun.resolveSync("@pierre/diffs/worker/worker.js", import.meta.dir);

await Promise.all([
	rm("static/build", { recursive: true, force: true }),
	rm("static/theme-lab.css", { force: true }),
]);

const results = await Promise.all([
	Bun.build({
		entrypoints: [
			"static/app/main.js",
			...(themeLab ? ["src/client/theme-lab.js"] : []),
		],
		outdir: "static/build",
		target: "browser",
		format: "esm",
		splitting: true,
		naming: {
			entry: "[name].js",
			chunk: "chunks/[name]-[hash].js",
			asset: "assets/[name]-[hash].[ext]",
		},
		define: { "process.env.NODE_ENV": JSON.stringify("production") },
		minify: true,
		external: ["shiki/wasm"],
		// Pierre registers the diffs-container custom element (and its adopted
		// base stylesheet) through an import side effect. Bun's tree shaking
		// drops that module on Windows by missing the package sideEffects entry,
		// which renders file previews unstyled.
		ignoreDCEAnnotations: true,
	}),
	Bun.build({
		entrypoints: [pierreWorker],
		outdir: "static/build",
		naming: "pierre-worker.js",
		target: "browser",
		format: "esm",
		external: ["shiki/wasm"],
		define: { "process.env.NODE_ENV": JSON.stringify("production") },
		minify: true,
	}),
	Bun.build({
		entrypoints: ["src/ui/app.css", ...(themeLab ? ["src/ui/theme-lab.css"] : [])],
		outdir: "static",
		naming: "[name].[ext]",
		minify: true,
	}),
]);

for (const result of results) {
	for (const log of result.logs) console.warn(log);
}
