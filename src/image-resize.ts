const maxWidth = 2_000;
const maxHeight = 2_000;
const maxBase64Bytes = 4.5 * 1_024 * 1_024;
const webpQuality = 80;

export type ResizedImage = Readonly<{
	data: string;
	mimeType: string;
	originalWidth: number;
	originalHeight: number;
	width: number;
	height: number;
	wasResized: boolean;
}>;

// Chat images render at most this wide (see .message-image max-width and the
// reserved box math in messages.tsx). Thumbnails encode to this target.
export const thumbnailDisplayWidth = 768;

export type ThumbnailImage = Readonly<{
	data: Uint8Array<ArrayBuffer>;
	mimeType: string;
	width: number;
	height: number;
}>;

/** Display-sized webp for chat images. Never upscales; GIF stays animated. */
export async function thumbnailImage(
	input: Uint8Array,
	mimeType: string,
): Promise<ThumbnailImage | undefined> {
	if (mimeType.toLowerCase().split(";", 1)[0] === "image/gif") return undefined;
	try {
		const metadata = await new Bun.Image(input).metadata();
		if (metadata.width <= thumbnailDisplayWidth) return undefined;
		const image = new Bun.Image(input).resize(
			thumbnailDisplayWidth,
			thumbnailDisplayWidth,
			{ fit: "inside", withoutEnlargement: true },
		);
		const data = Buffer.from(await image.webp({ quality: webpQuality }).bytes());
		return { data, mimeType: "image/webp", width: image.width, height: image.height };
	} catch {
		return undefined;
	}
}

export async function resizeImage(
	input: Uint8Array,
	mimeType: string,
): Promise<ResizedImage | undefined> {
	let metadata: Bun.Image.Metadata;
	try {
		metadata = await new Bun.Image(input).metadata();
	} catch {
		return undefined;
	}

	const normalizedMimeType = mimeType.toLowerCase().split(";", 1)[0];
	const withinLimits =
		metadata.width <= maxWidth &&
		metadata.height <= maxHeight &&
		base64Size(input.byteLength) < maxBase64Bytes;
	// GIF is kept as-is so animation survives.
	if (normalizedMimeType === "image/gif" && withinLimits) {
		return {
			data: input.toBase64(),
			mimeType: "image/gif",
			originalWidth: metadata.width,
			originalHeight: metadata.height,
			width: metadata.width,
			height: metadata.height,
			wasResized: false,
		};
	}

	let width = metadata.width;
	let height = metadata.height;
	if (width > maxWidth) {
		height = Math.round((height * maxWidth) / width);
		width = maxWidth;
	}
	if (height > maxHeight) {
		width = Math.round((width * maxHeight) / height);
		height = maxHeight;
	}

	while (true) {
		const webp = await encodeWebp(input, width, height);
		if (webp && webp.length < maxBase64Bytes) {
			return {
				data: webp,
				mimeType: "image/webp",
				originalWidth: metadata.width,
				originalHeight: metadata.height,
				width,
				height,
				wasResized: width !== metadata.width || height !== metadata.height,
			};
		}

		if (width === 1 && height === 1) return undefined;
		width = width === 1 ? 1 : Math.max(1, Math.floor(width * 0.75));
		height = height === 1 ? 1 : Math.max(1, Math.floor(height * 0.75));
	}
}

async function encodeWebp(
	input: Uint8Array,
	width: number,
	height: number,
): Promise<string | undefined> {
	try {
		const image = new Bun.Image(input).resize(width, height, {
			fit: "inside",
			withoutEnlargement: true,
		});
		return await image.webp({ quality: webpQuality }).toBase64();
	} catch {
		return undefined;
	}
}

function base64Size(bytes: number): number {
	return Math.ceil(bytes / 3) * 4;
}
