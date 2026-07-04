import { ServerSentEventGenerator } from "@starfederation/datastar-sdk/web";

export type DatastarSignals = Record<string, unknown>;
export type DatastarStream = ServerSentEventGenerator;

export function datastarStream(
	onStart: (stream: DatastarStream) => Promise<void> | void,
	options?: Parameters<typeof ServerSentEventGenerator.stream>[1],
): Response {
	return ServerSentEventGenerator.stream(onStart, options);
}

export function signalsResponse(signals: DatastarSignals): Response {
	return datastarStream((stream) => {
		stream.patchSignals(JSON.stringify(signals));
	});
}

export async function readSignals(request: Request): Promise<DatastarSignals> {
	const result = await ServerSentEventGenerator.readSignals(request);
	if (!result.success) {
		return {};
	}
	return isRecord(result.signals.datastar) ? result.signals.datastar : result.signals;
}

export async function readSignalString(request: Request, key: string): Promise<string> {
	const signals = await readSignals(request);
	const value = signals[key];
	return typeof value === "string" ? value : String(value ?? "");
}

function isRecord(value: unknown): value is DatastarSignals {
	return typeof value === "object" && value !== null && !Array.isArray(value);
}
