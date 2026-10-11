import { AsyncLocalStorage } from "node:async_hooks";

import type { Models } from "@earendil-works/pi-ai";

const platformFetch = globalThis.fetch;
const agentProxy = new AsyncLocalStorage<string>();
const proxyByRuntime = new WeakMap<Models, string>();
let scopedFetchInstalled = false;

export function configureAgentHttpProxy(
	modelRuntime: Models,
	httpProxy: string | undefined,
): void {
	const proxy = httpProxy?.trim();
	if (!proxy) return;

	installScopedFetch();
	proxyByRuntime.set(modelRuntime, proxy);
	const streamSimple = modelRuntime.streamSimple.bind(modelRuntime);
	modelRuntime.streamSimple = (model, context, options) =>
		agentProxy.run(proxy, () =>
			streamSimple(model, context, {
				...options,
				env: {
					HTTP_PROXY: proxy,
					HTTPS_PROXY: proxy,
					...options?.env,
				},
			}),
		);
	const classify = modelRuntime.classify.bind(modelRuntime);
	modelRuntime.classify = (model, context, options) =>
		agentProxy.run(proxy, () =>
			classify(model, context, {
				...options,
				env: {
					HTTP_PROXY: proxy,
					HTTPS_PROXY: proxy,
					...options?.env,
				},
			}),
		);
}

export function withAgentHttpProxy<Result>(
	modelRuntime: Models,
	request: () => Result,
): Result {
	const proxy = proxyByRuntime.get(modelRuntime);
	return proxy ? agentProxy.run(proxy, request) : request();
}

function installScopedFetch(): void {
	if (scopedFetchInstalled) return;
	scopedFetchInstalled = true;
	// SAFETY: scopedProxyFetch preserves the platform fetch parameters and response contract.
	globalThis.fetch = scopedProxyFetch as typeof fetch;
}

function scopedProxyFetch(
	input: RequestInfo | URL,
	init?: RequestInit,
): Promise<Response> {
	const proxy = agentProxy.getStore();
	if (!proxy || (init && "proxy" in init)) return platformFetch(input, init);
	// Bun applies NO_PROXY (wildcards, CIDR blocks, bare IPv6, host:port)
	// to an explicit proxy natively, so no manual matching here.
	return platformFetch(input, { ...init, proxy });
}
