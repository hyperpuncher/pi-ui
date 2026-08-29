import { test } from "bun:test";

import { assertEquals } from "#testing/assertions";

import { resizeImage } from "./image-resize.ts";

const png = Uint8Array.fromBase64(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
);
// Trailing bytes exceed the base64 limit while remaining valid image input.
const oversizedInputSize = 3_600_000;

test("resizing skips PNG encoding for JPEG sources", async () => {
	const jpeg = await new Bun.Image(png).jpeg({ quality: 85 }).bytes();
	const oversized = new Uint8Array(oversizedInputSize);
	oversized.set(jpeg);

	const result = await resizeImage(oversized, "image/jpeg");

	assertEquals(result?.mimeType, "image/jpeg");
});

test("resizing preserves PNG encoding for PNG sources", async () => {
	const oversized = new Uint8Array(oversizedInputSize);
	oversized.set(png);

	const result = await resizeImage(oversized, "image/png");

	assertEquals(result?.mimeType, "image/png");
});
