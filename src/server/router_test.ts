import { test } from "bun:test";

import { assertEquals, assertStringIncludes } from "#testing/assertions";

import { assertStringExcludes } from "../testing/assertions.ts";
import { ExactRouter } from "./router.ts";

test("exact router matches method and pathname and reports 404/405", async () => {
	const router = new ExactRouter({ value: "first" });
	router.register(
		"POST",
		"/action",
		(_request, context) => new Response(context.value),
	);
	assertEquals(
		await (await router.fetch(request("POST", "/action?x=1"))).text(),
		"first",
	);
	assertEquals((await router.fetch(request("GET", "/action"))).status, 405);
	assertEquals((await router.fetch(request("POST", "/other"))).status, 404);
});

test("exact router turns thrown handlers into generic 500 responses", async () => {
	const reported: unknown[] = [];
	const router = new ExactRouter({}, (error) => reported.push(error));
	router.register("GET", "/throw", () => {
		throw new Error("local details");
	});
	const response = await router.fetch(request("GET", "/throw"));
	assertEquals(response.status, 500);
	assertEquals(reported.length, 1);
	assertStringExcludes(await response.text(), "local details");
});

test("exact router silently handles aborted requests", async () => {
	const reported: unknown[] = [];
	const router = new ExactRouter({}, (error) => reported.push(error));
	router.register(
		"GET",
		"/slow",
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
	);
	const controller = new AbortController();
	const response = router.fetch(
		new Request("http://localhost/slow", { signal: controller.signal }),
	);
	controller.abort();

	assertEquals((await response).status, 499);
	assertEquals(reported, []);
});

test("exact router reads mutable replacement resources from context", async () => {
	const context = { resource: { name: "first" } };
	const router = new ExactRouter(context);
	router.register(
		"GET",
		"/resource",
		(_request, current) => new Response(current.resource.name),
	);
	assertEquals(await (await router.fetch(request("GET", "/resource"))).text(), "first");
	context.resource = { name: "second" };
	assertStringIncludes(
		await (await router.fetch(request("GET", "/resource"))).text(),
		"second",
	);
});

function request(method: string, path: string): Request {
	return new Request(`http://localhost${path}`, { method });
}
