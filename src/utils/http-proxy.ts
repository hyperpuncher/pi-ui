import { AsyncLocalStorage } from "node:async_hooks";

import type { Models } from "@earendil-works/pi-ai";

import { isString } from "./type-guards.ts";

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

	const targetUrl = fetchTargetUrl(input);
	if (!targetUrl || !shouldProxy(targetUrl)) return platformFetch(input, init);

	return platformFetch(input, { ...init, proxy });
}

function fetchTargetUrl(input: RequestInfo | URL): URL | undefined {
	try {
		if (isString(input)) return new URL(input);
		if (input instanceof URL) return input;
		if (input instanceof Request) return new URL(input.url);
		return undefined;
	} catch {
		return undefined;
	}
}

function shouldProxy(url: URL): boolean {
	const noProxy = (process.env.no_proxy || process.env.NO_PROXY || "").toLowerCase();
	if (!noProxy) return true;
	if (noProxy === "*") return false;

	const hostname = url.hostname;
	const port = Number.parseInt(url.port, 10) || defaultPort(url.protocol);
	const entries = noProxy.split(/[,\s]/).filter(Boolean);
	return entries.every((entry) => proxyEntryDoesNotMatch(entry, hostname, port));
}

function proxyEntryDoesNotMatch(entry: string, hostname: string, port: number): boolean {
	const parsed = entry.match(/^(.+):(\d+)$/);
	let entryHost = parsed ? parsed[1]! : entry;
	const entryPort = parsed ? Number.parseInt(parsed[2]!, 10) : 0;

	if (entryPort && entryPort !== port) return true;
	if (!/^[.*]/.test(entryHost)) return hostname !== entryHost;
	if (entryHost.startsWith("*")) entryHost = entryHost.slice(1);
	return !hostname.endsWith(entryHost);
}

function defaultPort(protocol: string): number {
	if (protocol === "http:" || protocol === "ws:") return 80;
	if (protocol === "https:" || protocol === "wss:") return 443;
	if (protocol === "ftp:") return 21;
	if (protocol === "gopher:") return 70;
	return 0;
}
