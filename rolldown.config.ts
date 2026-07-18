import { defineConfig } from "npm:rolldown@latest";

export default defineConfig((commandLineArgs) => {
	const watch = commandLineArgs.watch === true;
	return {
		input: {
			"pierre-worker": "src/client/pierre-worker.ts",
			"workspace-review": "src/client/workspace-review.ts",
		},
		output: {
			assetFileNames: "assets/[name]-[hash][extname]",
			chunkFileNames: "chunks/[name]-[hash].js",
			cleanDir: true,
			dir: "static/build",
			entryFileNames: "[name].js",
			format: "esm",
			minify: !watch,
			sourcemap: watch ? "inline" : false,
			strictExecutionOrder: true,
		},
		platform: "browser",
		treeshake: {
			moduleSideEffects: (id) =>
				id.includes("@pierre/diffs") &&
				(id.includes("/worker/worker") ||
					id.includes("/components/web-components")),
		},
		transform: {
			define: {
				"process.env.NODE_ENV": JSON.stringify(
					watch ? "development" : "production",
				),
			},
			target: "chrome120",
		},
	};
});
