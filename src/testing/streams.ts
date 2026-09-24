export function responseReader(
	response: Response,
): ReadableStreamDefaultReader<Uint8Array> {
	const reader = response.body?.getReader();
	if (!reader) throw new Error("Missing response body");
	return reader;
}

export async function readUntil(
	reader: ReadableStreamDefaultReader<Uint8Array>,
	complete: (text: string) => boolean,
	message = "Expected stream output was not received",
	// A throttled real-time stream (e.g. a scripted turn with a tokens/sec limit, see
	// `fake-stream-provider.ts`) can legitimately take many more small chunks to reach a
	// given point than a same-tick synthetic one; 200 gives real streaming room without
	// letting a truly stuck stream hang the test suite.
	maxReads = 200,
): Promise<string> {
	const decoder = new TextDecoder();
	let output = "";
	for (let index = 0; index < maxReads; index += 1) {
		const chunk = await reader.read();
		if (chunk.done) break;
		output += decoder.decode(chunk.value, { stream: true });
		if (complete(output)) return output;
	}
	throw new Error(message);
}
