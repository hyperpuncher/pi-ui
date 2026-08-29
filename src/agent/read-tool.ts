import { access, readFile } from "node:fs/promises";

import {
	createReadToolDefinition,
	defineTool,
	detectSupportedImageMimeTypeFromFile,
	formatDimensionNote,
} from "@earendil-works/pi-coding-agent";

import { resizeImage } from "../image-resize.ts";

type PreparedImage = Readonly<{
	bytes: Buffer;
	mimeType: string;
	dimensionNote?: string;
}>;

export function createBunReadToolDefinition(cwd: string) {
	const pendingImages = new Map<string, PreparedImage[]>();
	const pendingNotes = new Map<string, string[]>();
	const definition = createReadToolDefinition(cwd, {
		autoResizeImages: false,
		operations: {
			access,
			async detectImageMimeType(path) {
				const mimeType = await detectSupportedImageMimeTypeFromFile(path);
				if (!mimeType) return null;
				const image = await resizeImage(await readFile(path), mimeType);
				if (!image) throw new Error(`Could not process image: ${path}`);
				enqueue(pendingImages, path, {
					bytes: Buffer.from(image.data, "base64"),
					mimeType: image.mimeType,
					dimensionNote: formatDimensionNote(image),
				});
				return image.mimeType;
			},
			async readFile(path) {
				const image = dequeue(pendingImages, path);
				if (!image) return readFile(path);
				if (image.dimensionNote) enqueue(pendingNotes, path, image.dimensionNote);
				return image.bytes;
			},
		},
	});
	const execute = definition.execute;
	definition.execute = async (...args: Parameters<typeof execute>) => {
		const result = await execute(...args);
		const note = dequeue(pendingNotes, args[1].path);
		const text = result.content.find((item) => item.type === "text");
		if (note && text?.type === "text") text.text += `\n${note}`;
		return result;
	};
	return defineTool(definition);
}

function enqueue<T>(items: Map<string, T[]>, path: string, item: T): void {
	const queue = items.get(path);
	if (queue) queue.push(item);
	else items.set(path, [item]);
}

function dequeue<T>(items: Map<string, T[]>, path: string): T | undefined {
	const queue = items.get(path);
	const item = queue?.shift();
	if (queue?.length === 0) items.delete(path);
	return item;
}
