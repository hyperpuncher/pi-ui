import { fallbackDisplayHz } from "../state/streaming-frame-scheduler.ts";

type DisplayClient = {
	connections: number;
	hz: number;
};

/** Tracks display requirements separately from reconnecting stream instances. */
export class DisplayRefreshClients {
	private readonly clients = new Map<string, DisplayClient>();

	get clientCount(): number {
		return this.clients.size;
	}

	get targetHz(): number {
		let target: number | undefined;
		for (const client of this.clients.values()) {
			if (target === undefined || client.hz > target) target = client.hz;
		}
		return target ?? fallbackDisplayHz;
	}

	connect(id: string): void {
		const client = this.clients.get(id);
		if (client) {
			client.connections += 1;
			return;
		}
		this.clients.set(id, { connections: 1, hz: fallbackDisplayHz });
	}

	disconnect(id: string): void {
		const client = this.clients.get(id);
		if (!client) return;
		client.connections -= 1;
		if (client.connections === 0) this.clients.delete(id);
	}

	setHz(id: string, hz: number): boolean {
		const client = this.clients.get(id);
		if (!client) return false;
		client.hz = hz;
		return true;
	}
}
