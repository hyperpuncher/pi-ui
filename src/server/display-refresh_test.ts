import { test } from "bun:test";

import { assertEquals } from "#testing/assertions";

import { readDisplayRefreshUpdate } from "./display-refresh.ts";

test("display refresh update accepts only identified safe-range JSON", async () => {
	const clientId = "123e4567-e89b-42d3-a456-426614174000";
	for (const hz of [60, 75, 90, 100, 120, 144, 165, 240]) {
		assertEquals(await readDisplayRefreshUpdate(request({ clientId, hz })), {
			clientId,
			hz,
		});
	}
	for (const body of [
		{ clientId, hz: 29 },
		{ clientId, hz: 241 },
		{ clientId, hz: "144" },
		{ clientId: "not-a-client", hz: 144 },
		{ hz: 144 },
		{},
		null,
	]) {
		assertEquals(await readDisplayRefreshUpdate(request(body)), undefined);
	}
});

function request(body: Parameters<typeof JSON.stringify>[0]): Request {
	return new Request("http://localhost/display-refresh", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}
