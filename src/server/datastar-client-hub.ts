import {
	type DatastarStream,
	datastarStream,
	patchElements,
	type PatchElementsOptions,
} from "#src/server/datastar.ts";

/** Owns the persistent read connections, not application or rendering state. */
export class DatastarClientHub {
	private readonly clients = new Map<
		string,
		{ stream: DatastarStream; disconnect: () => void }
	>();

	constructor(private readonly streamFactory = datastarStream) {}

	get clientCount(): number {
		return this.clients.size;
	}

	createStream(
		signal: AbortSignal,
		initial: () => { elements: string; signals: string },
		options: { onDisconnect?: () => void } = {},
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
				this.clients.set(id, { stream, disconnect });
				signal.addEventListener("abort", disconnect, { once: true });
				if (signal.aborted) {
					disconnect();
					return;
				}
				try {
					const view = initial();
					this.patchClient(stream, view.elements, view.signals, []);
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
		options: PatchElementsOptions & { scripts?: readonly string[] } = {},
	): void {
		const { scripts = [], ...patchOptions } = options;
		this.broadcast((client) => {
			patchElements(client, elements, { ...patchOptions, selector });
			for (const script of scripts) client.executeScript(script);
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

	private broadcast(send: (client: DatastarStream) => void): void {
		for (const { stream, disconnect } of this.clients.values()) {
			try {
				send(stream);
			} catch {
				disconnect();
			}
		}
	}

	private patchClient(
		client: DatastarStream,
		elements: string,
		signals: string,
		scripts: readonly string[],
	): void {
		if (elements) patchElements(client, elements);
		if (signals && signals !== "{}") client.patchSignals(signals);
		if (scripts.length > 0) client.executeScript(scripts.join(";"));
	}
}
