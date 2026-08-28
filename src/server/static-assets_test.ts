import { test } from "bun:test";

import { assertEquals, assertNotEquals } from "#testing/assertions";
import { remove, writeTextFile } from "#testing/files";
import { makeTempDir } from "#testing/temp";

import { createStaticAssetServer } from "./static-assets.ts";

test("static assets use content versions and explicit cache policies", async () => {
	const root = await makeTempDir();
	try {
		await writeTextFile(`${root}/app.js`, "export const value = 1;\n");
		await writeTextFile(`${root}/manifest.webmanifest`, "{}");
		const first = await createStaticAssetServer(root);
		const immutable = await first.serve(
			new Request(`http://localhost/static/${first.version}/app.js`),
		);
		assertEquals(immutable.status, 200);
		assertEquals(await immutable.text(), "export const value = 1;\n");
		assertEquals(
			immutable.headers.get("cache-control"),
			"public, max-age=31536000, immutable",
		);

		const legacy = await first.serve(new Request("http://localhost/app.js"));
		assertEquals(legacy.headers.get("cache-control"), "no-cache, must-revalidate");

		const manifest = await first.serve(
			new Request(`http://localhost/static/${first.version}/manifest.webmanifest`),
		);
		assertEquals(
			manifest.headers.get("content-type"),
			"application/manifest+json; charset=utf-8",
		);

		await writeTextFile(`${root}/app.js`, "export const value = 2;\n");
		const second = await createStaticAssetServer(root);
		assertNotEquals(second.version, first.version);
	} finally {
		await remove(root, { recursive: true });
	}
});
