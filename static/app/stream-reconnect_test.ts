import { test } from "bun:test";

import { assertEquals } from "#testing/assertions";

import { createStreamReconnectMonitor } from "./stream-reconnect.js";

test("forces a reconnect when eligible", () => {
	let sent = 0;
	const monitor = createStreamReconnectMonitor({
		isEligible: () => true,
		send: () => (sent += 1),
		now: () => 0,
	});
	assertEquals(monitor.maybeReconnect(), true);
	assertEquals(sent, 1);
});

test("skips reconnecting while ineligible (e.g. the page is hidden)", () => {
	let sent = 0;
	const monitor = createStreamReconnectMonitor({
		isEligible: () => false,
		send: () => (sent += 1),
	});
	assertEquals(monitor.maybeReconnect(), false);
	assertEquals(sent, 0);
});

test("debounces a burst of near-simultaneous triggers (visibilitychange + online)", () => {
	let sent = 0;
	let clock = 0;
	const monitor = createStreamReconnectMonitor({
		isEligible: () => true,
		send: () => (sent += 1),
		now: () => clock,
		minIntervalMs: 5000,
	});
	assertEquals(monitor.maybeReconnect(), true);
	clock = 1000;
	assertEquals(monitor.maybeReconnect(), false);
	assertEquals(sent, 1);
});

test("reconnects again once the debounce window has passed", () => {
	let sent = 0;
	let clock = 0;
	const monitor = createStreamReconnectMonitor({
		isEligible: () => true,
		send: () => (sent += 1),
		now: () => clock,
		minIntervalMs: 5000,
	});
	monitor.maybeReconnect();
	clock = 6000;
	assertEquals(monitor.maybeReconnect(), true);
	assertEquals(sent, 2);
});
