import { assertStringIncludes } from "@std/assert";

import { renderLlamaDialogContent } from "./llama-dialog.tsx";

Deno.test("llama dialog renders model actions and loading progress", () => {
	const html = renderLlamaDialogContent({
		serverUrl: "http://127.0.0.1:8080",
		models: [
			{ id: "qwen-27b", status: "loading" },
			{ id: "loaded-model", status: "loaded" },
		],
		busyModel: "qwen-27b",
		progress: { label: "Loading text model", ratio: 0.42 },
		status: "Loading qwen-27b…",
	});

	assertStringIncludes(html, "llama.cpp models");
	assertStringIncludes(html, "qwen-27b");
	assertStringIncludes(html, "/llama/toggle");
	assertStringIncludes(html, 'role="progressbar"');
	assertStringIncludes(html, 'aria-valuenow="42"');
	assertStringIncludes(html, "Loading text model");
});
