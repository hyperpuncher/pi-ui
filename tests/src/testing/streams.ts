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
): Promise<string> {
	const decoder = new TextDecoder();
	let output = "";
	for (let index = 0; index < 30; index += 1) {
		const chunk = await reader.read();
		if (chunk.done) break;
		output += decoder.decode(chunk.value, { stream: true });
		if (complete(output)) return output;
	}
	throw new Error(message);
}
