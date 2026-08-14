import { assertEquals } from "@std/assert";

import { AppStore } from "../state/app-store.ts";
import { LlamaController } from "./llama-controller.ts";

Deno.test("unload accepts the router's forced-exit status", async () => {
	let unloaded = false;
	let refreshes = 0;
	const server = Deno.serve(
		{ hostname: "127.0.0.1", port: 0, onListen: () => {} },
		(request) => {
			const path = new URL(request.url).pathname;
			if (path === "/models/unload") {
				unloaded = true;
				return Response.json({ success: true });
			}
			if (path === "/models") {
				return Response.json({
					data: [
						{
							id: "qwen",
							status: unloaded
								? { value: "unloaded", failed: true, exit_code: 1 }
								: { value: "loaded" },
						},
					],
				});
			}
			return new Response(null, { status: 404 });
		},
	);
	const address = server.addr;
	if (address.transport !== "tcp") throw new Error("Expected a TCP test server");
	const serverUrl = `http://127.0.0.1:${address.port}`;
	const runtime = {
		services: {
			modelRuntime: {
				getAuth: () =>
					Promise.resolve({ auth: { apiKey: "local", baseUrl: serverUrl } }),
				refresh: () => {
					refreshes++;
					return Promise.resolve({ aborted: false, errors: new Map() });
				},
			},
		},
	};
	const state = new AppStore();
	state.setLlamaDialog({
		models: [{ id: "qwen", status: "loaded" }],
		serverUrl,
	});
	const controller = new LlamaController(
		() => runtime,
		state,
		() => {},
	);

	try {
		assertEquals(controller.toggle("qwen"), true);
		await waitUntil(() => state.llamaDialog?.status === "Unloaded qwen.");
		assertEquals(state.llamaDialog?.error, undefined);
		assertEquals(state.llamaDialog?.models[0]?.status, "unloaded");
		assertEquals(refreshes, 1);
	} finally {
		controller.dispose();
		await server.shutdown();
	}
});

async function waitUntil(predicate: () => boolean): Promise<void> {
	const deadline = Date.now() + 2_000;
	while (!predicate()) {
		if (Date.now() >= deadline)
			throw new Error("Timed out waiting for llama operation");
		await new Promise((resolve) => setTimeout(resolve, 20));
	}
}
