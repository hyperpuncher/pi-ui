import { test } from "bun:test";

import { assertEquals } from "#testing/assertions";

import { assertStringExcludes } from "../testing/assertions.ts";
import { executeRoute } from "./route.ts";

test("route errors hide details and report unexpected failures", async () => {
	const reported: unknown[] = [];
	const response = await executeRoute(
		new Request("http://localhost/throw"),
		{},
		() => {
			throw new Error("local details");
		},
		(error) => reported.push(error),
	);

	assertEquals(response.status, 500);
	assertEquals(reported.length, 1);
	assertStringExcludes(await response.text(), "local details");
});

test("aborted route requests fail silently", async () => {
	const reported: unknown[] = [];
	const controller = new AbortController();
	const response = executeRoute(
		new Request("http://localhost/slow", { signal: controller.signal }),
		{},
		(request) =>
			new Promise((_resolve, reject) => {
				request.signal.addEventListener(
					"abort",
					() => reject(request.signal.reason),
					{
						once: true,
					},
				);
			}),
		(error) => reported.push(error),
	);
	controller.abort();

	assertEquals((await response).status, 499);
	assertEquals(reported, []);
});
