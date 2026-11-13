export type StoredSessionImage = {
	data: Uint8Array<ArrayBuffer>;
	mimeType: string;
};

export class SessionImageStore {
	readonly #images = new Map<string, StoredSessionImage>();

	/** Decodes the base64 payload once; later requests serve the stored bytes. */
	register(image: { data: string; mimeType: string }): string {
		const id = crypto.randomUUID();
		this.#images.set(id, {
			data: Uint8Array.fromBase64(image.data),
			mimeType: image.mimeType,
		});
		return `/sessions/image?id=${encodeURIComponent(id)}`;
	}

	get(id: string): StoredSessionImage | undefined {
		return this.#images.get(id);
	}

	clear(): void {
		this.#images.clear();
	}
}
