export function applyHttpProxySetting(httpProxy: string | undefined): void {
	const proxy = httpProxy?.trim();
	if (!proxy) return;
	Deno.env.set("HTTP_PROXY", Deno.env.get("HTTP_PROXY") ?? proxy);
	Deno.env.set("HTTPS_PROXY", Deno.env.get("HTTPS_PROXY") ?? proxy);
}

export function createProxyClient(targetUrl: string): Deno.HttpClient | undefined {
	const proxyUrl = proxyUrlForTarget(targetUrl);
	if (!proxyUrl) return undefined;
	return Deno.createHttpClient({ proxy: { url: proxyUrl } });
}

function proxyUrlForTarget(targetUrl: string): string | undefined {
	let url: URL;
	try {
		url = new URL(targetUrl);
	} catch {
		return undefined;
	}

	if (!shouldProxy(url)) return undefined;

	const protocol = url.protocol.slice(0, -1);
	const proxy = proxyEnv(`${protocol}_proxy`) || proxyEnv("all_proxy");
	if (!proxy) return undefined;
	return proxy.includes("://") ? proxy : `${protocol}://${proxy}`;
}

function shouldProxy(url: URL): boolean {
	const noProxy = proxyEnv("no_proxy").toLowerCase();
	if (!noProxy) return true;
	if (noProxy === "*") return false;

	const hostname = url.hostname;
	const port = Number.parseInt(url.port, 10) || defaultPort(url.protocol);
	return noProxy.split(/[,\s]/).every((entry) => {
		if (!entry) return true;

		const parsed = entry.match(/^(.+):(\d+)$/);
		let entryHost = parsed ? parsed[1]! : entry;
		const entryPort = parsed ? Number.parseInt(parsed[2]!, 10) : 0;
		if (entryPort && entryPort !== port) return true;

		if (!/^[.*]/.test(entryHost)) return hostname !== entryHost;
		if (entryHost.startsWith("*")) entryHost = entryHost.slice(1);
		return !hostname.endsWith(entryHost);
	});
}

function proxyEnv(name: string): string {
	return Deno.env.get(name.toLowerCase()) || Deno.env.get(name.toUpperCase()) || "";
}

function defaultPort(protocol: string): number {
	if (protocol === "http:" || protocol === "ws:") return 80;
	if (protocol === "https:" || protocol === "wss:") return 443;
	if (protocol === "ftp:") return 21;
	if (protocol === "gopher:") return 70;
	return 0;
}
