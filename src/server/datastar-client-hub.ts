import { sessionPerformance } from "../perf/session-performance.ts";
import { datastarStream, type DatastarStream } from "./datastar.ts";

export type DatastarClient = Pick<
	DatastarStream,
	"patchElements" | "patchSignals" | "executeScript" | "close"
>;
export type DatastarStreamFactory = typeof datastarStream;

/** Owns long-lived Datastar clients and accepts only rendered presentation data. */
export class DatastarClientHub {
	private readonly clients = new Map<string, DatastarClient>();

	constructor(
		private readonly streamFactory: DatastarStreamFactory = datastarStream,
		private readonly recordPerformance = true,
	) {}

	get clientCount(): number {
		return this.clients.size;
	}

	createStream(
		signal: AbortSignal,
		initial: () => { elements: string; signals: string },
	): Response {
		const id = crypto.randomUUID();
		return this.streamFactory(
			(stream) => {
				this.clients.set(id, stream);
				try {
					const view = initial();
					this.patchClient(stream, view.elements, view.signals, []);
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
				onAbort: () => {
					this.clients.delete(id);
				},
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

	patchElement(elements: string, selector: string): void {
		for (const [id, client] of this.clients) {
			try {
				client.patchElements(elements, { selector });
				if (this.recordPerformance) {
					sessionPerformance.recordTargetedMessagePatch(elements);
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

	private patchClient(
		client: DatastarClient,
		elements: string,
		signals: string,
		scripts: readonly string[],
	): void {
		client.patchElements(elements);
		if (this.recordPerformance) {
			sessionPerformance.recordFatMorph(elements);
			sessionPerformance.markFirstTranscriptPatch();
		}
		client.patchSignals(signals);
		if (scripts.length > 0) client.executeScript(scripts.join(";"));
	}

	private disconnect(id: string, client: DatastarClient): void {
		this.clients.delete(id);
		try {
			client.close();
		} catch {
			/* Already closed. */
		}
	}
}
