import { test } from "bun:test";

import { assertEquals } from "#testing/assertions";

import { fallbackDisplayHz } from "../state/streaming-frame-scheduler.ts";
import { DisplayRefreshClients } from "./display-refresh-clients.ts";

test("display clients select the highest connected refresh rate", () => {
	const clients = new DisplayRefreshClients();
	assertEquals(clients.targetHz, fallbackDisplayHz);

	clients.connect("slow");
	clients.setHz("slow", 60);
	clients.connect("fast");
	clients.setHz("fast", 240);
	assertEquals(clients.targetHz, 240);

	clients.disconnect("fast");
	assertEquals(clients.targetHz, 60);
	clients.disconnect("slow");
	assertEquals(clients.targetHz, fallbackDisplayHz);
});

test("display clients survive overlapping reconnects and reject stale updates", () => {
	const clients = new DisplayRefreshClients();
	clients.connect("client");
	clients.setHz("client", 165);
	clients.connect("client");
	clients.disconnect("client");
	assertEquals(clients.clientCount, 1);
	assertEquals(clients.targetHz, 165);

	clients.disconnect("client");
	assertEquals(clients.clientCount, 0);
	assertEquals(clients.setHz("client", 240), false);
});
