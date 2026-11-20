import { type ThumbnailImage, thumbnailImage } from "#src/image-resize.ts";
import { BoundedCache } from "#src/ui/render-cache.ts";

export type StoredSessionImage = {
	data: Uint8Array<ArrayBuffer>;
	mimeType: string;
};

export class SessionImageStore {
	readonly #images = new Map<string, StoredSessionImage>();
	readonly #thumbnails = new BoundedCache<string, ThumbnailImage>(200, {
		maxWeight: 16 * 1024 * 1024,
		weight: (_key, value) => value.data.byteLength,
	});

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

	async getThumbnail(id: string): Promise<ThumbnailImage | undefined> {
		const image = this.#images.get(id);
		if (!image) return undefined;
		const cached = this.#thumbnails.get(id);
		if (cached) return cached;
		const thumbnail = await thumbnailImage(image.data, image.mimeType);
		if (!thumbnail) return undefined;
		this.#thumbnails.set(id, thumbnail);
		return thumbnail;
	}

	clear(): void {
		this.#images.clear();
		this.#thumbnails.clear();
	}
}
