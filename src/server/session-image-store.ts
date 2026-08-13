export type StoredSessionImage = {
	data: string;
	mimeType: string;
};

export class SessionImageStore {
	readonly #images = new Map<string, StoredSessionImage>();
	register(image: StoredSessionImage): string {
		const id = crypto.randomUUID();
		this.#images.set(id, image);
		return `/sessions/image?id=${encodeURIComponent(id)}`;
	}

	get(id: string): StoredSessionImage | undefined {
		return this.#images.get(id);
	}

	clear(): void {
		this.#images.clear();
	}
}

export function decodeBase64Image(data: string): Uint8Array<ArrayBuffer> {
	const binary = atob(data);
	const bytes = new Uint8Array(binary.length);
	for (let index = 0; index < binary.length; index += 1) {
		bytes[index] = binary.charCodeAt(index);
	}
	return bytes;
}
