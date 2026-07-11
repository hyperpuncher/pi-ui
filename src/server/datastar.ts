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

export function refreshBasecoatComponentsScript(...selectors: string[]): string {
	return `queueMicrotask(() => document.querySelectorAll(${JSON.stringify(
		selectors.join(", "),
	)}).forEach((component) => component.refresh?.()))`;
}

export function datastarStream(
	onStart: (stream: DatastarStream) => Promise<void> | void,
	options?: Parameters<typeof ds.stream>[1],
) {
	return ds.stream((stream) => onStart(new DatastarStream(stream)), options);
}

export function signalsResponse(signals: Record<string, Jsonifiable>) {
	return datastarStream((stream) => {
		stream.patchSignals(JSON.stringify(signals));
	});
}

export function scriptResponse(script: string) {
	return datastarStream((stream) => {
		stream.executeScript(script);
	});
}

export function scriptAndSignalsResponse(
	script: string,
	signals: Record<string, Jsonifiable>,
) {
	return datastarStream((stream) => {
		stream.patchSignals(JSON.stringify(signals));
		stream.executeScript(script);
	});
}

export function elementsAndScriptResponse(
	elements: string,
	script: string,
	signals: Record<string, Jsonifiable> = {},
) {
	return datastarStream((stream) => {
		stream.patchElements(elements);
		if (Object.keys(signals).length > 0) {
			stream.patchSignals(JSON.stringify(signals));
		}
		stream.executeScript(script);
	});
}

function normalizeSseData(value: string): string {
	return value.replaceAll("\r\n", "\n").replaceAll("\r", "\n");
}

export async function readSignals(request: Request) {
	const result = await ds.readSignals(request);
	if (!result.success) {
		return {};
	}
	return result.signals;
}
