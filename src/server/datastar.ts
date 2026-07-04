export function sseHeaders(): Headers {
	return new Headers({
		"content-type": "text/event-stream; charset=utf-8",
		"cache-control": "no-cache, no-transform",
		connection: "keep-alive",
	});
}

export function patchElements(elements: string): string {
	return datastarEvent("datastar-patch-elements", `elements ${elements}`);
}

export function patchSignals(signals: Record<string, unknown>): string {
	return datastarEvent("datastar-patch-signals", `signals ${JSON.stringify(signals)}`);
}

function datastarEvent(event: string, data: string): string {
	return `event: ${event}\ndata: ${data.replaceAll("\n", "\ndata: ")}\n\n`;
}
