import { describe, expect, test } from "bun:test";

import { probeImageDimensions } from "#src/utils/image-dimensions.ts";

describe("probeImageDimensions", () => {
	const pixel = Buffer.from(
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==",
		"base64",
	);
	async function fixture(
		encode: (image: Bun.Image) => Promise<Uint8Array<ArrayBufferLike>>,
	) {
		const bytes = await encode(new Bun.Image(pixel).resize(320, 240));
		return Buffer.from(bytes).toString("base64");
	}

	test("reads png headers", async () => {
		expect(
			probeImageDimensions(await fixture((image) => image.png().bytes())),
		).toEqual({
			width: 320,
			height: 240,
		});
	});

	test("reads jpeg headers", async () => {
		expect(
			probeImageDimensions(await fixture((image) => image.jpeg().bytes())),
		).toEqual({
			width: 320,
			height: 240,
		});
	});

	test("reads gif headers", () => {
		const header = Buffer.concat([
			Buffer.from("GIF89a", "ascii"),
			Buffer.from([0x40, 0x01, 0xf0, 0x00]),
		]);
		expect(probeImageDimensions(header.toString("base64"))).toEqual({
			width: 320,
			height: 240,
		});
	});

	test("reads webp headers", async () => {
		expect(
			probeImageDimensions(await fixture((image) => image.webp().bytes())),
		).toEqual({
			width: 320,
			height: 240,
		});
	});

	test("rejects garbage", () => {
		expect(probeImageDimensions("aW1hZ2U=")).toBeUndefined();
		expect(probeImageDimensions("!!!not-base64!!!")).toBeUndefined();
	});
});
