// Sync image header probe. Bun.Image cannot do this synchronously: its
// width/height read -1 until an async metadata() terminal resolves, and
// project() runs in the sync render path. This reads the same header bytes
// from a small base64 slice, no io. Covers every format `resizeImage` emits
// (png, jpeg, gif, webp).
export function probeImageDimensions(
	data: string,
): { width: number; height: number } | undefined {
	let bytes: Uint8Array;
	try {
		bytes = Buffer.from(data.slice(0, 5464), "base64");
	} catch {
		return undefined;
	}
	if (bytes.length < 10) return undefined;
	if (
		bytes[0] === 0x89 &&
		bytes[1] === 0x50 &&
		bytes[2] === 0x4e &&
		bytes[3] === 0x47
	) {
		if (bytes.length < 24) return undefined;
		const view = new DataView(bytes.buffer, bytes.byteOffset);
		return { width: view.getUint32(16), height: view.getUint32(20) };
	}
	if (bytes[0] === 0xff && bytes[1] === 0xd8) return jpegDimensions(bytes);
	if (bytes[0] === 0x47 && bytes[1] === 0x49 && bytes[2] === 0x46) {
		const view = new DataView(bytes.buffer, bytes.byteOffset);
		return { width: view.getUint16(6, true), height: view.getUint16(8, true) };
	}
	if (
		bytes[0] === 0x52 &&
		bytes[1] === 0x49 &&
		bytes[2] === 0x46 &&
		bytes[3] === 0x46 &&
		bytes[8] === 0x57 &&
		bytes[9] === 0x45 &&
		bytes[10] === 0x42 &&
		bytes[11] === 0x50
	) {
		return webpDimensions(bytes);
	}
	return undefined;
}

function jpegDimensions(
	bytes: Uint8Array,
): { width: number; height: number } | undefined {
	const view = new DataView(bytes.buffer, bytes.byteOffset);
	let offset = 2;
	while (offset + 9 < bytes.length) {
		if (bytes[offset] !== 0xff) return undefined;
		const marker = bytes[offset + 1];
		// SOF0-SOF15 except DHT (c4) and JPG (c8): frame header with dims.
		if (marker >= 0xc0 && marker <= 0xcf && marker !== 0xc4 && marker !== 0xc8) {
			return {
				height: view.getUint16(offset + 5),
				width: view.getUint16(offset + 7),
			};
		}
		offset += 2 + view.getUint16(offset + 2);
	}
	return undefined;
}

function webpDimensions(
	bytes: Uint8Array,
): { width: number; height: number } | undefined {
	const view = new DataView(bytes.buffer, bytes.byteOffset);
	const chunk = String.fromCharCode(bytes[12], bytes[13], bytes[14], bytes[15]);
	if (chunk === "VP8 ") {
		if (bytes.length < 30) return undefined;
		return {
			width: view.getUint16(26, true) & 0x3fff,
			height: view.getUint16(28, true) & 0x3fff,
		};
	}
	if (chunk === "VP8L") {
		if (bytes.length < 25) return undefined;
		const [b0, b1, b2, b3] = [bytes[21], bytes[22], bytes[23], bytes[24]];
		return {
			width: (b0 | ((b1 & 0x3f) << 8)) + 1,
			height: (((b1 >> 6) | (b2 << 2) | ((b3 & 0x0f) << 10)) & 0x3fff) + 1,
		};
	}
	if (chunk === "VP8X") {
		if (bytes.length < 30) return undefined;
		return {
			width: (bytes[24] | (bytes[25] << 8) | (bytes[26] << 16)) + 1,
			height: (bytes[27] | (bytes[28] << 8) | (bytes[29] << 16)) + 1,
		};
	}
	return undefined;
}
