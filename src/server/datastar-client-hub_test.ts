import { assertEquals, assertStringIncludes } from "@std/assert";

import { DatastarClientHub, type DatastarClient } from "./datastar-client-hub.ts";
import { DatastarStream } from "./datastar.ts";

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
	hub.replaceElement('<main id="messages">replaced</main>', "#messages");
	hub.patchSignals('{"extra":true}');
	controller.abort();
	assertEquals(hub.clientCount, 0);

	const body = await response.text();
	assertStringIncludes(body, "initial");
	assertStringIncludes(body, "updated");
	assertStringIncludes(body, "selector #message");
	assertStringIncludes(body, "selector #messages");
	assertStringIncludes(body, "mode replace");
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

Deno.test("hub runs disconnect lifecycle once across overlapping close signals", () => {
	const hub = new DatastarClientHub();
	const controller = new AbortController();
	let disconnects = 0;
	const response = hub.createStream(
		controller.signal,
		() => ({ elements: "", signals: "{}" }),
		{ onDisconnect: () => (disconnects += 1) },
	);
	controller.abort();
	controller.abort();
	assertEquals(disconnects, 1);
	return response.body?.cancel();
});

Deno.test("hub removes a client after a failed send", () => {
	let closed = false;
	let disconnects = 0;
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
	const stream = Object.assign(Object.create(DatastarStream.prototype), client);
	const factory: ConstructorParameters<typeof DatastarClientHub>[0] = (start) => {
		start(stream);
		return new Response();
	};
	const hub = new DatastarClientHub(factory);

	hub.createStream(
		new AbortController().signal,
		() => ({ elements: "initial", signals: "{}" }),
		{ onDisconnect: () => (disconnects += 1) },
	);
	assertEquals(hub.clientCount, 0);
	assertEquals(disconnects, 1);
	assertEquals(closed, true);
});
