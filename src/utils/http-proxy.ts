import { EventEmitter } from "node:events";
import process from "node:process";

import * as undici from "undici";

export const defaultHttpIdleTimeoutMs = 300_000;

const originalFetch = globalThis.fetch;
const proxyClients = new Map<string, Deno.HttpClient>();
let proxyFetchInstalled = false;

export function applyHttpProxySetting(httpProxy: string | undefined): void {
	const proxy = httpProxy?.trim();
	if (!proxy) {
		return;
	}

	Deno.env.set("HTTP_PROXY", Deno.env.get("HTTP_PROXY") ?? proxy);
	Deno.env.set("HTTPS_PROXY", Deno.env.get("HTTPS_PROXY") ?? proxy);
	process.env.HTTP_PROXY ??= proxy;
	process.env.HTTPS_PROXY ??= proxy;
	installDenoFetchProxy();
}

export function configureHttpDispatcher(
	timeoutMs: number = defaultHttpIdleTimeoutMs,
): void {
	const dispatcher = new undici.EnvHttpProxyAgent({
		allowH2: false,
		bodyTimeout: timeoutMs,
		headersTimeout: timeoutMs,
		clientFactory: createUndiciClient,
		factory: createUndiciOriginDispatcher,
	});

	undici.setGlobalDispatcher(withUndiciErrorListener(dispatcher));
}

export function createProxyClient(targetUrl: string): Deno.HttpClient | undefined {
	const proxyUrl = proxyUrlForTarget(targetUrl);
	if (!proxyUrl) {
		return undefined;
	}

	return getProxyClient(proxyUrl);
}

function installDenoFetchProxy(): void {
	if (proxyFetchInstalled) {
		return;
	}

	proxyFetchInstalled = true;
	globalThis.fetch = proxyFetch as typeof fetch;
}

function proxyFetch(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
	if (init && "client" in init) {
		return originalFetch(input, init);
	}

	const targetUrl = fetchTargetUrl(input);
	if (!targetUrl) {
		return originalFetch(input, init);
	}

	const client = createProxyClient(targetUrl);
	if (!client) {
		return originalFetch(input, init);
	}

	return originalFetch(input, { ...init, client } as RequestInit);
}

function fetchTargetUrl(input: RequestInfo | URL): string | undefined {
	if (typeof input === "string") {
		return input;
	}
	if (input instanceof URL) {
		return input.href;
	}
	if (input instanceof Request) {
		return input.url;
	}

	return undefined;
}

function getProxyClient(proxyUrl: string): Deno.HttpClient {
	const existingClient = proxyClients.get(proxyUrl);
	if (existingClient) {
		return existingClient;
	}

	const client = Deno.createHttpClient({ proxy: { url: proxyUrl } });
	proxyClients.set(proxyUrl, client);
	return client;
}

function withUndiciErrorListener<T extends undici.Dispatcher>(dispatcher: T): T {
	if (dispatcher instanceof EventEmitter) {
		EventEmitter.prototype.on.call(dispatcher, "error", ignoreUndiciDispatcherError);
	}

	return dispatcher;
}

function ignoreUndiciDispatcherError(_error: unknown): void {
	// Undici emits internal client errors while fetch bodies reject normally.
}

function createUndiciClient(origin: string | URL, options: object): undici.Dispatcher {
	const clientOptions = options as undici.Client.Options;
	const client = new undici.Client(origin, clientOptions);
	return withUndiciErrorListener(client);
}

function createUndiciOriginDispatcher(
	origin: string | URL,
	options: object,
): undici.Dispatcher {
	const poolOptions = options as undici.Pool.Options;
	if (poolOptions.connections === 1) {
		return createUndiciClient(origin, poolOptions);
	}

	const pool = new undici.Pool(origin, {
		...poolOptions,
		factory: createUndiciClient,
	});
	return withUndiciErrorListener(pool);
}

function proxyUrlForTarget(targetUrl: string): string | undefined {
	let url: URL;
	try {
		url = new URL(targetUrl);
	} catch {
		return undefined;
	}

	if (!shouldProxy(url)) {
		return undefined;
	}

	const protocol = url.protocol.slice(0, -1);
	const proxy =
		Deno.env.get(`${protocol}_proxy`) ||
		Deno.env.get(`${protocol}_proxy`.toUpperCase()) ||
		Deno.env.get("all_proxy") ||
		Deno.env.get("ALL_PROXY");
	if (!proxy) {
		return undefined;
	}

	if (proxy.includes("://")) {
		return proxy;
	}
	return `${protocol}://${proxy}`;
}

function shouldProxy(url: URL): boolean {
	const noProxy = (
		Deno.env.get("no_proxy") ||
		Deno.env.get("NO_PROXY") ||
		""
	).toLowerCase();
	if (!noProxy) {
		return true;
	}
	if (noProxy === "*") {
		return false;
	}

	const hostname = url.hostname;
	const port = Number.parseInt(url.port, 10) || defaultPort(url.protocol);
	const entries = noProxy.split(/[,\s]/).filter(Boolean);
	return entries.every((entry) => proxyEntryDoesNotMatch(entry, hostname, port));
}

function proxyEntryDoesNotMatch(entry: string, hostname: string, port: number): boolean {
	const parsed = entry.match(/^(.+):(\d+)$/);
	let entryHost = parsed ? parsed[1]! : entry;
	const entryPort = parsed ? Number.parseInt(parsed[2]!, 10) : 0;

	if (entryPort && entryPort !== port) {
		return true;
	}

	if (!/^[.*]/.test(entryHost)) {
		return hostname !== entryHost;
	}

	if (entryHost.startsWith("*")) {
		entryHost = entryHost.slice(1);
	}
	return !hostname.endsWith(entryHost);
}

function defaultPort(protocol: string): number {
	if (protocol === "http:" || protocol === "ws:") {
		return 80;
	}
	if (protocol === "https:" || protocol === "wss:") {
		return 443;
	}
	if (protocol === "ftp:") {
		return 21;
	}
	if (protocol === "gopher:") {
		return 70;
	}

	return 0;
}
