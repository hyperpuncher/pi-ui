const maxWidth = 2_000;
const maxHeight = 2_000;
const maxBase64Bytes = 4.5 * 1_024 * 1_024;
const jpegQualities = [85, 70, 55, 40] as const;

export type ResizedImage = Readonly<{
	data: string;
	mimeType: string;
	originalWidth: number;
	originalHeight: number;
	width: number;
	height: number;
	wasResized: boolean;
}>;

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
	if (
		["image/gif", "image/jpeg", "image/png", "image/webp"].includes(
			normalizedMimeType,
		) &&
		metadata.width <= maxWidth &&
		metadata.height <= maxHeight &&
		base64Size(input.byteLength) < maxBase64Bytes
	) {
		return {
			data: input.toBase64(),
			mimeType: normalizedMimeType,
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
		const png = await encode(input, width, height, "png");
		if (png && png.length < maxBase64Bytes) {
			return {
				data: png,
				mimeType: "image/png",
				originalWidth: metadata.width,
				originalHeight: metadata.height,
				width,
				height,
				wasResized: width !== metadata.width || height !== metadata.height,
			};
		}
		for (const quality of jpegQualities) {
			const jpeg = await encode(input, width, height, "jpeg", quality);
			if (jpeg && jpeg.length < maxBase64Bytes) {
				return {
					data: jpeg,
					mimeType: "image/jpeg",
					originalWidth: metadata.width,
					originalHeight: metadata.height,
					width,
					height,
					wasResized: width !== metadata.width || height !== metadata.height,
				};
			}
		}

		if (width === 1 && height === 1) return undefined;
		width = width === 1 ? 1 : Math.max(1, Math.floor(width * 0.75));
		height = height === 1 ? 1 : Math.max(1, Math.floor(height * 0.75));
	}
}

async function encode(
	input: Uint8Array,
	width: number,
	height: number,
	format: "jpeg" | "png",
	quality: number = jpegQualities[0],
): Promise<string | undefined> {
	try {
		const image = new Bun.Image(input).resize(width, height, {
			fit: "inside",
			withoutEnlargement: true,
		});
		return format === "png"
			? await image.png().toBase64()
			: await image.jpeg({ quality }).toBase64();
	} catch {
		return undefined;
	}
}

function base64Size(bytes: number): number {
	return Math.ceil(bytes / 3) * 4;
}
