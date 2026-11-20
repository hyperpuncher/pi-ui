import type { JsonObject } from "#src/utils/type-guards.ts";

// Datastar SSE protocol: https://data-star.dev/reference/sse_events
export type PatchElementsOptions = {
	selector?: string;
	mode?:
		| "outer"
		| "inner"
		| "replace"
		| "prepend"
		| "append"
		| "before"
		| "after"
		| "remove";
	useViewTransition?: boolean;
	viewTransitionSelector?: string;
};

export type DatastarStream = {
	patchElements(elements: string, options?: PatchElementsOptions): void;
	patchSignals(signals: string): void;
	executeScript(script: string): void;
	close(): void;
};

export type DatastarEvent =
	| { type: "elements"; elements: string; options?: PatchElementsOptions }
	| { type: "signals"; signals: JsonObject }
	| { type: "script"; script: string };

const encoder = new TextEncoder();
const sseHeaders = {
	"cache-control": "no-cache",
	"content-type": "text/event-stream",
};

/** SSE splits data lines on CR, LF, and CRLF, so each source line needs its own prefix. */
function dataLines(name: string, value: string): string {
	const normalized = value.includes("\r") ? value.replace(/\r\n?/g, "\n") : value;
	const prefix = `data: ${name} `;
	return `${prefix}${normalized.replaceAll("\n", `\n${prefix}`)}\n`;
}

function event(type: string, lines: string): string {
	return `event: ${type}\n${lines}\n`;
}

function patchElementsEvent(
	elements: string,
	options: PatchElementsOptions = {},
): string {
	let lines = "";
	if (options.selector) lines += dataLines("selector", options.selector);
	if (options.mode && options.mode !== "outer")
		lines += dataLines("mode", options.mode);
	if (options.useViewTransition) lines += dataLines("useViewTransition", "true");
	if (options.viewTransitionSelector)
		lines += dataLines("viewTransitionSelector", options.viewTransitionSelector);
	if (elements) lines += dataLines("elements", elements);
	return event("datastar-patch-elements", lines);
}

function streamWriter(
	controller: ReadableStreamDefaultController<Uint8Array>,
): DatastarStream {
	const write = (text: string) => controller.enqueue(encoder.encode(text));
	return {
		patchElements: (elements, options) =>
			write(patchElementsEvent(elements, options)),
		patchSignals: (signals) =>
			write(event("datastar-patch-signals", dataLines("signals", signals))),
		executeScript: (script) =>
			write(
				patchElementsEvent(
					`<script data-effect="el.remove()">${script}</script>`,
					{
						selector: "body",
						mode: "append",
					},
				),
			),
		close: () => {
			try {
				controller.close();
			} catch {
				// Already closed.
			}
		},
	};
}

/**
 * Opens an SSE response. Finite streams close after `onStart`; persistent
 * streams stay open until the client disconnects and then call `onAbort`.
 */
export function datastarStream(
	onStart: (stream: DatastarStream) => Promise<void> | void,
	options: { keepalive?: boolean; onAbort?: () => void } = {},
): Response {
	const body = new ReadableStream<Uint8Array>({
		async start(controller) {
			const stream = streamWriter(controller);
			try {
				await onStart(stream);
			} catch (error) {
				options.onAbort?.();
				stream.close();
				throw error;
			}
			if (!options.keepalive) stream.close();
		},
		cancel: () => options.onAbort?.(),
	});
	return new Response(body, { headers: sseHeaders });
}

/**
 * Builds a finite Datastar response and preserves event order.
 *
 * State-only commands normally return an empty response (204) and let the main
 * stream confirm backend state. Query routes may return finite element patches.
 * Signal patches are reserved for restoring or clearing browser-owned drafts.
 */
export function datastarResponse(events: readonly DatastarEvent[] = []): Response {
	if (events.length === 0) return new Response(null, { status: 204 });
	return datastarStream((stream) => {
		for (const event of events) {
			if (event.type === "elements")
				stream.patchElements(event.elements, event.options);
			else if (event.type === "signals")
				stream.patchSignals(JSON.stringify(event.signals));
			else stream.executeScript(event.script);
		}
	});
}

export function errorResponse(status: number, message: string): Response {
	return Response.json({ error: message }, { status });
}

export function signalsResponse(signals: JsonObject): Response {
	return datastarResponse([{ type: "signals", signals }]);
}
