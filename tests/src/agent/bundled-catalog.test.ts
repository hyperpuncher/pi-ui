import { onTestFinished, test } from "bun:test";
import { rm } from "node:fs/promises";
import { fileURLToPath } from "node:url";

import { openrouterProvider } from "@earendil-works/pi-ai/providers/openrouter";

import { version } from "#pi/package.json";
import { assertEquals } from "#testing/assertions";
import { makeTempDir } from "#testing/temp";

test("bundled catalog requests identify the installed pi SDK version", async () => {
	const outdir = await makeTempDir();
	onTestFinished(() => rm(outdir, { recursive: true, force: true }));
	const bundle = await Bun.build({
		entrypoints: [
			fileURLToPath(import.meta.resolve("#pi/core/remote-catalog-provider.js")),
		],
		outdir,
		target: "bun",
	});
	const { withRemoteCatalog }: typeof import("#pi/core/remote-catalog-provider.js") =
		await import(bundle.outputs[0].path);

	let userAgent: string | undefined;
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		fetch(request) {
			userAgent = request.headers.get("user-agent")?.split(" ", 1)[0];
			return Response.json([]);
		},
	});
	onTestFinished(() => server.stop(true));
	const provider = withRemoteCatalog(openrouterProvider(), server.url.origin);
	await provider.refreshModels?.({
		allowNetwork: true,
		signal: AbortSignal.timeout(3000),
		publish: async () => true,
	});

	assertEquals(userAgent, `pi/${version}`);
});
