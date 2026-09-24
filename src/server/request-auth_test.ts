import { test } from "bun:test";

import { assertEquals, assertStringIncludes } from "#testing/assertions";

import { checkAuthToken, withAuthToken } from "./request-auth.ts";

const token = "secret-token-value";

test("a request with no token is rejected with 401", async () => {
	const result = checkAuthToken(new Request("http://localhost/"), token);
	assertEquals(result.ok, false);
	if (!result.ok) {
		assertEquals(result.response.status, 401);
		assertEquals(result.response.headers.get("www-authenticate"), "Bearer");
	}
});

test("a wrong bearer token is rejected", () => {
	const request = new Request("http://localhost/", {
		headers: { authorization: "Bearer wrong" },
	});
	assertEquals(checkAuthToken(request, token).ok, false);
});

test("a correct bearer token is accepted without setting a cookie", () => {
	const request = new Request("http://localhost/", {
		headers: { authorization: `Bearer ${token}` },
	});
	const result = checkAuthToken(request, token);
	assertEquals(result.ok, true);
	if (result.ok) assertEquals(result.setCookie, undefined);
});

test("a correct query-parameter token is accepted and asks to set a cookie", () => {
	const request = new Request(`http://localhost/?token=${encodeURIComponent(token)}`);
	const result = checkAuthToken(request, token);
	assertEquals(result.ok, true);
	if (result.ok) {
		assertStringIncludes(
			result.setCookie ?? "",
			`pi_ui_token=${encodeURIComponent(token)}`,
		);
		assertStringIncludes(result.setCookie ?? "", "HttpOnly");
		assertStringIncludes(result.setCookie ?? "", "SameSite=Lax");
	}
});

test("a wrong query-parameter token is rejected", () => {
	const request = new Request("http://localhost/?token=wrong");
	assertEquals(checkAuthToken(request, token).ok, false);
});

test("a previously-set cookie is accepted, without asking to set it again", () => {
	const request = new Request("http://localhost/", {
		headers: { cookie: `pi_ui_token=${encodeURIComponent(token)}; other=1` },
	});
	const result = checkAuthToken(request, token);
	assertEquals(result.ok, true);
	if (result.ok) assertEquals(result.setCookie, undefined);
});

test("a wrong cookie value is rejected", () => {
	const request = new Request("http://localhost/", {
		headers: { cookie: "pi_ui_token=wrong" },
	});
	assertEquals(checkAuthToken(request, token).ok, false);
});

test("withAuthToken rejects unauthenticated requests without calling the handler", async () => {
	let called = false;
	const handler = withAuthToken(async (_request: Request) => {
		called = true;
		return new Response("ok");
	}, token);
	const response = await handler(new Request("http://localhost/"));
	assertEquals(response.status, 401);
	assertEquals(called, false);
});

test("withAuthToken calls the handler and sets the cookie on a query-token first visit", async () => {
	const handler = withAuthToken(async (_request: Request) => new Response("ok"), token);
	const response = await handler(
		new Request(`http://localhost/?token=${encodeURIComponent(token)}`),
	);
	assertEquals(response.status, 200);
	assertEquals(await response.text(), "ok");
	assertStringIncludes(response.headers.get("set-cookie") ?? "", "pi_ui_token=");
});

test("withAuthToken calls the handler without touching set-cookie on a cookie-authenticated visit", async () => {
	const handler = withAuthToken(async (_request: Request) => new Response("ok"), token);
	const response = await handler(
		new Request("http://localhost/", {
			headers: { cookie: `pi_ui_token=${encodeURIComponent(token)}` },
		}),
	);
	assertEquals(response.status, 200);
	assertEquals(response.headers.get("set-cookie"), null);
});
