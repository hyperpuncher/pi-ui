const DEFAULT_MIN_INTERVAL_MS = 5000;

/**
 * Decides when to force-reopen the main SSE stream instead of waiting for
 * Datastar's passive retry to notice a dead connection. A mobile carrier
 * NAT/proxy or a backgrounded Android WebView can silently drop an idle
 * connection without either end seeing an error; the transport only finds out
 * once new data is expected, which can be a long wait on a screen nobody is
 * looking at. Re-triggering the same `@get(...)` action is safe to call
 * repeatedly (see the `data-init`/`pi-ui-stream-reconnect` comment in
 * page.tsx), so this just needs to debounce bursts of near-simultaneous
 * triggers (e.g. `visibilitychange` and `online` firing together).
 */
export function createStreamReconnectMonitor(options) {
	const minIntervalMs = options.minIntervalMs ?? DEFAULT_MIN_INTERVAL_MS;
	const now = options.now ?? (() => Date.now());
	let lastSentAt;

	function maybeReconnect() {
		if (!options.isEligible()) return false;
		const timestamp = now();
		if (lastSentAt !== undefined && timestamp - lastSentAt < minIntervalMs) {
			return false;
		}
		lastSentAt = timestamp;
		options.send();
		return true;
	}

	return { maybeReconnect };
}

export function bindStreamReconnect() {
	const monitor = createStreamReconnectMonitor({
		isEligible: () => document.visibilityState === "visible",
		send: () => {
			window.dispatchEvent(new CustomEvent("pi-ui-stream-reconnect"));
		},
	});
	document.addEventListener("visibilitychange", () => {
		if (document.visibilityState === "visible") monitor.maybeReconnect();
	});
	// Only bfcache restores need a forced reconnect here: a fresh navigation's
	// `pageshow` fires shortly after `data-init` already opened the stream, so
	// reconnecting again would just be redundant work.
	window.addEventListener("pageshow", (event) => {
		if (event.persisted) monitor.maybeReconnect();
	});
	window.addEventListener("online", () => monitor.maybeReconnect());
}
