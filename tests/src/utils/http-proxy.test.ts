import { afterAll, expect, test } from "bun:test";

import type { Models } from "@earendil-works/pi-ai";

import { configureAgentHttpProxy, withAgentHttpProxy } from "#src/utils/http-proxy.ts";

const deadProxy = "http://127.0.0.1:9";
const proxyEnvKeys = [
	"HTTP_PROXY",
	"HTTPS_PROXY",
	"ALL_PROXY",
	"NO_PROXY",
	"no_proxy",
] as const;

function fakeRuntime(): Models {
	return {
		streamSimple: () => Promise.reject(new Error("unused")),
		classify: () => Promise.reject(new Error("unused")),
	} as unknown as Models;
}

const runtime = fakeRuntime();
configureAgentHttpProxy(runtime, deadProxy);

const server = Bun.serve({
	hostname: "127.0.0.1",
	port: 0,
	fetch: () => new Response("ok"),
});
const targetUrl = `http://127.0.0.1:${server.port}/`;

afterAll(() => {
	server.stop(true);
});

async function withProxyEnv<T>(
	overrides: Partial<Record<(typeof proxyEnvKeys)[number], string>>,
	run: () => Promise<T>,
): Promise<T> {
	const saved = new Map<string, string | undefined>();
	for (const key of proxyEnvKeys) {
		saved.set(key, process.env[key]);
		delete process.env[key];
	}
	for (const [key, value] of Object.entries(overrides)) {
		process.env[key] = value;
	}
	try {
		return await run();
	} finally {
		for (const key of proxyEnvKeys) {
			const value = saved.get(key);
			if (value === undefined) delete process.env[key];
			else process.env[key] = value;
		}
	}
}

test("scoped fetch routes through the agent proxy", async () => {
	await withProxyEnv({ NO_PROXY: "" }, async () => {
		// Nothing listens on the dead proxy port, so reaching it proves
		// the request went through the proxy instead of direct.
		await expect(
			withAgentHttpProxy(runtime, () => fetch(targetUrl)),
		).rejects.toThrow();
	});
});

test("scoped fetch lets native NO_PROXY bypass the proxy", async () => {
	const response = await withProxyEnv({ NO_PROXY: "127.0.0.1" }, () =>
		withAgentHttpProxy(runtime, () => fetch(targetUrl)),
	);
	expect(await response.text()).toBe("ok");
});

test("fetch outside the scope stays direct", async () => {
	const response = await withProxyEnv({ NO_PROXY: "" }, () => fetch(targetUrl));
	expect(await response.text()).toBe("ok");
});

test("scoped fetch respects an explicit proxy option", async () => {
	const response = await withProxyEnv({ NO_PROXY: "" }, () =>
		withAgentHttpProxy(runtime, () =>
			fetch(targetUrl, { proxy: false } as unknown as RequestInit),
		),
	);
	expect(await response.text()).toBe("ok");
});

test("unconfigured runtimes run without a scope", async () => {
	const response = await withProxyEnv({ NO_PROXY: "" }, () =>
		withAgentHttpProxy(fakeRuntime(), () => fetch(targetUrl)),
	);
	expect(await response.text()).toBe("ok");
});
