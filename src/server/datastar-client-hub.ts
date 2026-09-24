import { sessionPerformance } from "../perf/session-performance.ts";
import { datastarStream, type DatastarStream } from "./datastar.ts";

export type DatastarClient = Pick<
	DatastarStream,
	"patchElements" | "patchSignals" | "executeScript" | "close"
>;
export type DatastarStreamFactory = typeof datastarStream;
export type DatastarClientStreamOptions = {
	onDisconnect?: () => void;
};

/**
 * Default interval between empty signal-patch heartbeats sent to every connected
 * client. A mobile carrier NAT/proxy or a backgrounded Android WebView commonly
 * drops an idle connection after 30-60s without notifying either end; sending real
 * SSE bytes on a shorter cadence keeps the connection alive and lets the transport
 * notice a genuinely dead socket (and disconnect it) instead of leaving a zombie
 * client registered indefinitely, since `idleTimeout: 0` never does that for us.
 */
const defaultHeartbeatIntervalMs = 20_000;

/** Owns long-lived Datastar clients and accepts only rendered presentation data. */
export class DatastarClientHub {
	private readonly clients = new Map<string, DatastarClient>();
	private readonly disconnectCallbacks = new Map<string, () => void>();
	private readonly heartbeatTimer: ReturnType<typeof setInterval> | undefined;

	constructor(
		private readonly streamFactory: DatastarStreamFactory = datastarStream,
		private readonly recordPerformance = true,
		heartbeatIntervalMs: number = defaultHeartbeatIntervalMs,
		scheduleInterval: (
			callback: () => void,
			intervalMs: number,
		) => ReturnType<typeof setInterval> = setInterval,
	) {
		if (heartbeatIntervalMs <= 0) return;
		this.heartbeatTimer = scheduleInterval(
			() => this.sendHeartbeat(),
			heartbeatIntervalMs,
		);
		// SAFETY: Bun/Node timers expose `unref`; browsers/tests do not, and a
		// heartbeat that merely fails to unref is a harmless idle timer, not a bug.
		(this.heartbeatTimer as { unref?: () => void }).unref?.();
	}

	get clientCount(): number {
		return this.clients.size;
	}

	createStream(
		signal: AbortSignal,
		initial: () => {
			elements: string;
			signals: string;
			scripts?: readonly string[];
		},
		options: DatastarClientStreamOptions = {},
	): Response {
		const id = crypto.randomUUID();
		return this.streamFactory(
			(stream) => {
				this.clients.set(id, stream);
				if (options.onDisconnect) {
					this.disconnectCallbacks.set(id, options.onDisconnect);
				}
				try {
					const view = initial();
					this.patchClient(
						stream,
						view.elements,
						view.signals,
						view.scripts ?? [],
					);
				} catch {
					this.disconnect(id, stream);
					return;
				}
				signal.addEventListener("abort", () => this.disconnect(id, stream), {
					once: true,
				});
			},
			{
				keepalive: true,
				onAbort: () => this.disconnectById(id),
			},
		);
	}

	patchView(elements: string, signals: string, scripts: readonly string[]): void {
		for (const [id, client] of this.clients) {
			try {
				this.patchClient(client, elements, signals, scripts);
			} catch {
				this.disconnect(id, client);
			}
		}
	}

	patchElement(
		elements: string,
		selector: string,
		options: {
			mode?: "outer" | "replace" | "append" | "after" | "remove";
			scripts?: readonly string[];
		} = {},
	): void {
		for (const [id, client] of this.clients) {
			try {
				client.patchElements(elements, {
					selector,
					mode: options.mode ?? "outer",
				});
				for (const script of options.scripts ?? []) client.executeScript(script);
				if (this.recordPerformance) {
					sessionPerformance.recordTargetedMessagePatch(elements);
				}
			} catch {
				this.disconnect(id, client);
			}
		}
	}

	replaceElement(elements: string, selector: string): void {
		for (const [id, client] of this.clients) {
			try {
				client.patchElements(elements, { selector, mode: "replace" });
				if (this.recordPerformance) {
					sessionPerformance.recordFatMorph(elements);
					sessionPerformance.markFirstTranscriptPatch();
				}
			} catch {
				this.disconnect(id, client);
			}
		}
	}

	patchSignals(signals: string): void {
		for (const [id, client] of this.clients) {
			try {
				client.patchSignals(signals);
			} catch {
				this.disconnect(id, client);
			}
		}
	}

	/** Stops the heartbeat timer; call on server shutdown to let the process exit. */
	dispose(): void {
		if (this.heartbeatTimer !== undefined) clearInterval(this.heartbeatTimer);
	}

	private sendHeartbeat(): void {
		if (this.clients.size === 0) return;
		// An empty JSON Merge Patch changes no signal, so this is invisible to the
		// client beyond keeping the connection warm.
		this.patchSignals("{}");
	}

	private patchClient(
		client: DatastarClient,
		elements: string,
		signals: string,
		scripts: readonly string[],
	): void {
		if (elements) {
			client.patchElements(elements);
			if (this.recordPerformance) {
				sessionPerformance.recordFatMorph(elements);
				if (elements.includes('id="messages"')) {
					sessionPerformance.markFirstTranscriptPatch();
				}
			}
		}
		client.patchSignals(signals);
		if (scripts.length > 0) client.executeScript(scripts.join(";"));
	}

	private disconnectById(id: string): void {
		const client = this.clients.get(id);
		if (client) this.disconnect(id, client);
	}

	private disconnect(id: string, client: DatastarClient): void {
		if (!this.clients.delete(id)) return;
		const onDisconnect = this.disconnectCallbacks.get(id);
		this.disconnectCallbacks.delete(id);
		onDisconnect?.();
		try {
			client.close();
		} catch {
			/* Already closed. */
		}
	}
}
