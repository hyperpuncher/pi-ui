import type { Jsonifiable } from "@starfederation/datastar-sdk/types";
import { ServerSentEventGenerator as ds } from "@starfederation/datastar-sdk/web";

export class DatastarStream {
	constructor(private readonly stream: ds) {}

	patchElements(elements: string, options?: Parameters<ds["patchElements"]>[1]) {
		return this.stream.patchElements(normalizeSseData(elements), options);
	}

	patchSignals(...args: Parameters<ds["patchSignals"]>) {
		return this.stream.patchSignals(...args);
	}

	executeScript(...args: Parameters<ds["executeScript"]>) {
		return this.stream.executeScript(...args);
	}

	close(): void {
		this.stream.close();
	}
}

export type ClientEffect =
	| { type: "focus-prompt" }
	| { type: "open-tree" }
	| { type: "restore-messages-anchor" }
	| { type: "refresh-session-picker" }
	| { type: "refresh-workspace-picker" }
	| { type: "session-deleted" };

export type DatastarEvent =
	| {
			type: "elements";
			elements: string;
			options?: Parameters<DatastarStream["patchElements"]>[1];
	  }
	| { type: "signals"; signals: Record<string, Jsonifiable> }
	| { type: "effect"; effect: ClientEffect };

export function datastarStream(
	onStart: (stream: DatastarStream) => Promise<void> | void,
	options?: Parameters<typeof ds.stream>[1],
) {
	return ds.stream((stream) => onStart(new DatastarStream(stream)), options);
}

/** Builds a finite Datastar response and preserves the supplied event order. */
export function datastarResponse(
	events: readonly DatastarEvent[] = [],
	init: ResponseInit = {},
): Response {
	if (events.length === 0)
		return new Response(null, { ...init, status: init.status ?? 204 });
	return datastarStream(
		(stream) => {
			for (const event of events) {
				if (event.type === "elements") {
					stream.patchElements(event.elements, event.options);
				} else if (event.type === "signals") {
					stream.patchSignals(JSON.stringify(event.signals));
				} else {
					stream.executeScript(clientEffectScript(event.effect));
				}
			}
		},
		{ responseInit: init as Record<string, unknown> },
	);
}

export function errorResponse(status: number, message: string): Response {
	return Response.json({ error: message }, { status });
}

export function signalsResponse(signals: Record<string, Jsonifiable>): Response {
	return datastarResponse([{ type: "signals", signals }]);
}

function clientEffectScript(effect: ClientEffect): string {
	switch (effect.type) {
		case "focus-prompt":
			return "document.getElementById('prompt-input')?.focus({ preventScroll: true })";
		case "open-tree":
			return "window.piUi.basecoat.refresh(document.getElementById('tree-dialog')); window.piUi.dialogs.openTree(); requestAnimationFrame(() => { const row = document.querySelector('[data-active-tree-row]'); row?.focus(); row?.scrollIntoView({ block: 'center' }); });";
		case "restore-messages-anchor":
			return "window.piUi.messageScroll.restoreAnchor()";
		case "refresh-session-picker":
			return "window.piUi.basecoat.refresh(document.getElementById('session-dialog'))";
		case "refresh-workspace-picker":
			return "window.piUi.basecoat.refresh(document.getElementById('workspace-dialog'))";
		case "session-deleted":
			return "document.getElementById('session-delete-dialog')?.close(); window.piUi.basecoat.refresh(document.getElementById('session-dialog')); document.getElementById('session-input')?.focus();";
	}
}

function normalizeSseData(value: string): string {
	return value.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}
