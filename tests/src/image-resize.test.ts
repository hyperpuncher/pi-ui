import { test } from "bun:test";

import { resizeImage } from "#src/image-resize.ts";
import { assertEquals } from "#testing/assertions";

const png = Uint8Array.fromBase64(
	"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=",
);
// Bun has no GIF encoder, so keep a 1x1 GIF literal.
const gif = Uint8Array.fromBase64(
	"R0lGODlhAQABAIAAAAAAAP///yH5BAEAAAAALAAAAAABAAEAAAIBRAA7",
);

test("resizing encodes small images to webp at their native size", async () => {
	const result = await resizeImage(png, "image/png");

	assertEquals(result?.mimeType, "image/webp");
	assertEquals(result?.wasResized, false);
	assertEquals(result?.width, 1);
	assertEquals(result?.height, 1);
});

test("resizing downscales images above the display limit", async () => {
	const large = await new Bun.Image(png)
		.resize(3000, 1500, { fit: "fill" })
		.png()
		.bytes();

	const result = await resizeImage(large, "image/png");

	assertEquals(result?.mimeType, "image/webp");
	assertEquals(result?.wasResized, true);
	assertEquals(result?.width, 2000);
	assertEquals(result?.height, 1000);
});

test("resizing keeps gif bytes untouched", async () => {
	const result = await resizeImage(gif, "image/gif");

	assertEquals(result?.mimeType, "image/gif");
	assertEquals(result?.data, Buffer.from(gif).toString("base64"));
});
