export async function collectElementPatches(
	response: Response,
	count: number,
): Promise<{
	fullPatchCount: number;
	targetedPatchCount: number;
	patches: string[];
}> {
	const reader = response.body?.getReader();
	if (!reader) throw new Error("Datastar response has no body");
	const decoder = new TextDecoder();
	let buffer = "";
	const patches: string[] = [];
	while (patches.length < count) {
		const chunk = await reader.read();
		if (chunk.done) break;
		buffer += decoder.decode(chunk.value, { stream: true });
		const frames = buffer.split("\n\n");
		buffer = frames.pop() ?? "";
		for (const frame of frames) {
			if (!frame.startsWith("event: datastar-patch-elements\n")) continue;
			patches.push(frame);
			if (patches.length === count) break;
		}
	}
	if (patches.length !== count) {
		throw new Error(`Expected ${count} element patches, received ${patches.length}`);
	}
	return {
		fullPatchCount: patches.filter((patch) => !patch.includes("\ndata: selector "))
			.length,
		targetedPatchCount: patches.filter((patch) => patch.includes("\ndata: selector "))
			.length,
		patches,
	};
}
