import { assertEquals, assertNotEquals } from "@std/assert";

import { createStaticAssetServer } from "./static-assets.ts";

Deno.test("static assets use content versions and explicit cache policies", async () => {
	const root = await Deno.makeTempDir();
	try {
		await Deno.writeTextFile(`${root}/app.js`, "export const value = 1;\n");
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

		await Deno.writeTextFile(`${root}/app.js`, "export const value = 2;\n");
		const second = await createStaticAssetServer(root);
		assertNotEquals(second.version, first.version);
	} finally {
		await Deno.remove(root, { recursive: true });
	}
});
