import { disableServerAutostart, enableServerAutostart } from "./server-autostart.ts";
import { parseServerOptions, serverUsage } from "./server-options.ts";
import { isVersionRequest, version } from "./version.ts";

async function main(): Promise<void> {
	const args = process.argv.slice(2);

	if (isVersionRequest(args)) {
		console.log(version);
	} else if (args[0] === "autostart") {
		if (args.length !== 2 || !["enable", "disable"].includes(args[1])) {
			throw new Error("usage: pi-ui autostart enable|disable");
		}
		if (args[1] === "enable") {
			await enableServerAutostart();
			console.log("pi-ui server will start automatically at login");
		} else {
			await disableServerAutostart();
			console.log("pi-ui server will no longer start automatically at login");
		}
	} else {
		const options = parseServerOptions(args, {
			host: process.env.PI_UI_HOST,
			port: process.env.PI_UI_PORT,
		});
		if (options.help) {
			console.log(serverUsage);
		} else {
			let appPromise: ReturnType<typeof loadApp> | undefined;
			const getApp = () => (appPromise ??= loadApp());
			const server = Bun.serve({
				hostname: options.hostname,
				port: options.port,
				idleTimeout: 0,
				async fetch(request, server) {
					const peer = server.requestIP(request);
					const loaded = await getApp();
					return loaded.compressResponse(
						request,
						await loaded.app.fetch(
							request,
							peer ? { address: peer.address } : undefined,
						),
					);
				},
			});
			let stopping = false;
			const stop = async () => {
				if (stopping) return;
				stopping = true;
				await server.stop();
				const loaded = await appPromise?.catch(() => undefined);
				await loaded?.app.dispose();
			};
			process.once("SIGINT", () => void stop());
			process.once("SIGTERM", () => void stop());
			console.log(`pi-ui listening on ${server.url}`);
		}
	}
}

async function loadApp() {
	const [{ registerBunOAuthFlows }, { createApp }, { compressResponse }] =
		await Promise.all([
			import("@earendil-works/pi-ai/bun-oauth"),
			import("./server/app.ts"),
			import("./server/compression.ts"),
		]);
	registerBunOAuthFlows();
	return { app: await createApp(), compressResponse };
}

main().catch((cause) => {
	console.error(cause);
	process.exitCode = 1;
});
