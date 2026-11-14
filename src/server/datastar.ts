import type { Jsonifiable } from "@starfederation/datastar-sdk/types";
import { ServerSentEventGenerator as ds } from "@starfederation/datastar-sdk/web";

export type DatastarStream = Pick<
	ds,
	"patchElements" | "patchSignals" | "executeScript" | "close"
>;

// The SDK serializes viewTransitionSelector but does not yet declare it.
export type PatchElementsOptions = Parameters<ds["patchElements"]>[1] & {
	viewTransitionSelector?: string;
};

/** SSE data lines split on CR as well as LF, so normalize line endings first. */
export function patchElements(
	stream: DatastarStream,
	elements: string,
	options?: PatchElementsOptions,
): void {
	stream.patchElements(
		elements.replaceAll("\r\n", "\n").replaceAll("\r", "\n"),
		options,
	);
}

export type DatastarEvent =
	| { type: "elements"; elements: string; options?: PatchElementsOptions }
	| { type: "signals"; signals: Record<string, Jsonifiable> }
	| { type: "script"; script: string };

export function datastarStream(
	onStart: (stream: DatastarStream) => Promise<void> | void,
	options?: Parameters<typeof ds.stream>[1],
) {
	return ds.stream(onStart, options);
}

/**
 * Builds a finite Datastar response and preserves event order.
 *
 * State-only commands normally return an empty response (204) and let the main
 * stream confirm backend state. Query routes may return finite element patches.
 * Signal patches are reserved for restoring or clearing browser-owned drafts.
 */
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
					patchElements(stream, event.elements, event.options);
				} else if (event.type === "signals") {
					stream.patchSignals(JSON.stringify(event.signals));
				} else {
					stream.executeScript(event.script);
				}
			}
		},
		{
			// SAFETY: Datastar forwards this value to the Response constructor as ResponseInit.
			responseInit: init as NonNullable<
				Parameters<typeof ds.stream>[1]
			>["responseInit"],
		},
	);
}

export function errorResponse(status: number, message: string): Response {
	return Response.json({ error: message }, { status });
}

export function signalsResponse(signals: Record<string, Jsonifiable>): Response {
	return datastarResponse([{ type: "signals", signals }]);
}
