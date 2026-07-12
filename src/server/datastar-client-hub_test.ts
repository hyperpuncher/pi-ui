import { assertEquals, assertStringIncludes } from "@std/assert";

import { DatastarClientHub, type DatastarClient } from "./datastar-client-hub.ts";
import type { DatastarStream } from "./datastar.ts";

Deno.test("hub connects, sends an initial view, broadcasts fat and targeted patches, and aborts", async () => {
	const hub = new DatastarClientHub();
	const controller = new AbortController();
	const response = hub.createStream(controller.signal, () => ({
		elements: '<main id="app">initial</main>',
		signals: '{"ready":true}',
	}));
	assertEquals(hub.clientCount, 1);
	hub.patchView('<main id="app">updated</main>', '{"ready":false}', []);
	hub.patchElement('<article id="message">target</article>', "#message");
	hub.patchSignals('{"extra":true}');
	controller.abort();
	assertEquals(hub.clientCount, 0);

	const body = await response.text();
	assertStringIncludes(body, "initial");
	assertStringIncludes(body, "updated");
	assertStringIncludes(body, "selector #message");
	assertStringIncludes(body, 'signals {"extra":true}');
});

Deno.test("hub broadcasts to multiple clients and disconnects them independently", async () => {
	const hub = new DatastarClientHub();
	const firstController = new AbortController();
	const secondController = new AbortController();
	const initial = () => ({ elements: '<main id="app">initial</main>', signals: "{}" });
	const first = hub.createStream(firstController.signal, initial);
	const second = hub.createStream(secondController.signal, initial);
	assertEquals(hub.clientCount, 2);

	firstController.abort();
	assertEquals(hub.clientCount, 1);
	hub.patchView('<main id="app">second only</main>', "{}", []);
	secondController.abort();

	assertEquals((await first.text()).includes("second only"), false);
	assertStringIncludes(await second.text(), "second only");
});

Deno.test("hub removes a client after a failed send", () => {
	let closed = false;
	const client: DatastarClient = {
		patchElements: () => {
			throw new Error("disconnected");
		},
		patchSignals: () => [],
		executeScript: () => [],
		close: () => {
			closed = true;
		},
	};
	const factory = ((start: (stream: DatastarStream) => void) => {
		start(client as DatastarStream);
		return new Response();
	}) as unknown as ConstructorParameters<typeof DatastarClientHub>[0];
	const hub = new DatastarClientHub(factory);

	hub.createStream(new AbortController().signal, () => ({
		elements: "initial",
		signals: "{}",
	}));
	assertEquals(hub.clientCount, 0);
	assertEquals(closed, true);
});
