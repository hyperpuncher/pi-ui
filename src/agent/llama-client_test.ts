import { test } from "bun:test";

import { assertEquals } from "#testing/assertions";

import { llamaLoadProgress, normalizeLlamaServerUrl } from "./llama-client.ts";

test("llama server URLs normalize to the router root", () => {
	assertEquals(
		normalizeLlamaServerUrl("http://localhost:8080/v1/"),
		"http://localhost:8080",
	);
	assertEquals(
		normalizeLlamaServerUrl("https://example.com/router/"),
		"https://example.com/router",
	);
});

test("llama loading stages map to overall progress", () => {
	assertEquals(
		llamaLoadProgress({
			model: "qwen",
			event: "model_status",
			data: {
				progress: {
					stages: ["text_model", "mmproj_model"],
					current: "text_model",
					value: 0.5,
				},
			},
		}),
		{ label: "Loading text model", ratio: 0.25 },
	);
});
