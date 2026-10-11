import { sessionPerformance } from "../perf/session-performance.ts";
import { datastarStream, type DatastarStream } from "./datastar.ts";

export type DatastarClient = Pick<
	DatastarStream,
	"patchElements" | "patchSignals" | "executeScript" | "close"
>;
export type DatastarClientStreamOptions = {
	onDisconnect?: () => void;
};

/** Owns the persistent read connections, not application or rendering state. */
export class DatastarClientHub {
	private readonly clients = new Map<
		string,
		{
			stream: DatastarClient;
			disconnect: () => void;
		}
	>();

	constructor(
		private readonly streamFactory = datastarStream,
		private readonly recordPerformance = true,
	) {}

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
				const disconnect = () => {
					if (!this.clients.delete(id)) return;
					signal.removeEventListener("abort", disconnect);
					stream.close();
					options.onDisconnect?.();
				};
				this.clients.set(id, {
					stream,
					disconnect,
				});
				signal.addEventListener("abort", disconnect, { once: true });
				if (signal.aborted) {
					disconnect();
					return;
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
					disconnect();
				}
			},
			{
				keepalive: true,
				onAbort: () => this.clients.get(id)?.disconnect(),
			},
		);
	}

	patchView(render: () => string, signals: string, scripts: readonly string[]): void {
		if (this.clientCount === 0) return;
		const elements = render();
		this.broadcast((client) => this.patchClient(client, elements, signals, scripts));
	}

	executeScript(script: string): void {
		this.broadcast((client) => client.executeScript(script));
	}

	patchElement(
		elements: string,
		selector: string,
		options: { scripts?: readonly string[] } = {},
	): void {
		this.broadcast((client) => {
			client.patchElements(elements, { selector });
			for (const script of options.scripts ?? []) client.executeScript(script);
			if (this.recordPerformance) {
				if (selector === "#messages") {
					sessionPerformance.recordFatMorph(elements);
					sessionPerformance.markFirstTranscriptPatch();
				} else sessionPerformance.recordTargetedMessagePatch(elements);
			}
		});
	}

	executeOnOneClient(script: string): void {
		for (const { stream, disconnect } of this.clients.values()) {
			try {
				stream.executeScript(script);
				return;
			} catch {
				disconnect();
			}
		}
	}

	patchSignals(signals: string): void {
		this.broadcast((client) => client.patchSignals(signals));
	}

	private broadcast(send: (client: DatastarClient) => void): void {
		for (const { stream, disconnect } of this.clients.values()) {
			try {
				send(stream);
			} catch {
				disconnect();
			}
		}
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
				if (elements.includes('id="messages"'))
					sessionPerformance.markFirstTranscriptPatch();
			}
		}
		if (signals && signals !== "{}") client.patchSignals(signals);
		if (scripts.length > 0) client.executeScript(scripts.join(";"));
	}
}
