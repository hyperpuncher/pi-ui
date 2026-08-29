import { test } from "bun:test";
import { join } from "node:path";

import type { ExtensionContext } from "@earendil-works/pi-coding-agent";

import { assertEquals, assertStringIncludes } from "#testing/assertions";
import { remove, writeFile, writeTextFile } from "#testing/files";
import { makeTempDir } from "#testing/temp";

import { createBunReadToolDefinition } from "./read-tool.ts";

const iconPath = join(import.meta.dir, "../../static/icon-192.png");
// SAFETY: the read definition only inspects the optional current model.
const context = {} as ExtensionContext;

function readPath(cwd: string, path: string) {
	return createBunReadToolDefinition(cwd).execute(
		"read",
		{ path },
		undefined,
		undefined,
		context,
	);
}

test("Bun read tool preserves text reads", async () => {
	const root = await makeTempDir();
	try {
		const path = join(root, "notes.txt");
		await writeTextFile(path, "one\ntwo");
		const result = await readPath(root, path);
		assertEquals(result.content, [{ type: "text", text: "one\ntwo" }]);
	} finally {
		await remove(root, { recursive: true });
	}
});

test("Bun read tool preserves images within the provider limits", async () => {
	const root = await makeTempDir();
	try {
		const source = await Bun.file(iconPath).bytes();
		const path = join(root, "small.png");
		await writeFile(path, source);

		const result = await readPath(root, path);
		assertEquals(result.content, [
			{ type: "text", text: "Read image file [image/png]" },
			{ type: "image", data: source.toBase64(), mimeType: "image/png" },
		]);
	} finally {
		await remove(root, { recursive: true });
	}
});

test("Bun read tool resizes images and reports coordinate scaling", async () => {
	const root = await makeTempDir();
	try {
		const source = await Bun.file(iconPath).bytes();
		const enlarged = await new Bun.Image(source)
			.resize(2_100, 1_050, { fit: "fill", withoutEnlargement: false })
			.png()
			.bytes();
		const path = join(root, "large.png");
		await writeFile(path, enlarged);

		const result = await readPath(root, path);
		const text = result.content.find((item) => item.type === "text");
		const image = result.content.find((item) => item.type === "image");
		if (text?.type !== "text" || image?.type !== "image") {
			throw new Error("Expected image read content.");
		}
		assertStringIncludes(text.text, "original 2100x1050, displayed at 2000x1000");
		assertEquals(await new Bun.Image(Uint8Array.fromBase64(image.data)).metadata(), {
			width: 2_000,
			height: 1_000,
			format: "png",
		});
	} finally {
		await remove(root, { recursive: true });
	}
});
