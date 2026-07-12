import { assertEquals } from "@std/assert";

import { readDisplayRefreshUpdate } from "./display-refresh.ts";

Deno.test("display refresh update accepts only typed safe-range JSON", async () => {
	for (const hz of [60, 75, 90, 100, 120, 144, 165, 240]) {
		assertEquals((await readDisplayRefreshUpdate(request({ hz })))?.hz, hz);
	}
	for (const body of [{ hz: 29 }, { hz: 241 }, { hz: "144" }, {}, null]) {
		assertEquals(await readDisplayRefreshUpdate(request(body)), undefined);
	}
});

function request(body: unknown): Request {
	return new Request("http://localhost/display-refresh", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(body),
	});
}
