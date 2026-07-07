import type { Jsonifiable } from "@starfederation/datastar-sdk/types";
import { ServerSentEventGenerator as ds } from "@starfederation/datastar-sdk/web";

export type DatastarStream = ds;

export function refreshBasecoatComponentsScript(...selectors: string[]): string {
	return `queueMicrotask(() => document.querySelectorAll(${JSON.stringify(
		selectors.join(", "),
	)}).forEach((component) => component.refresh?.()))`;
}

export function datastarStream(
	onStart: (stream: DatastarStream) => Promise<void> | void,
	options?: Parameters<typeof ds.stream>[1],
) {
	return ds.stream(onStart, options);
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

export async function readSignals(request: Request) {
	const result = await ds.readSignals(request);
	if (!result.success) {
		return {};
	}
	return result.signals;
}
