import { importLoginShellEnvironment } from "./login-shell-environment.ts";
import { disableServerAutostart, enableServerAutostart } from "./server-autostart.ts";
import { parseServerOptions, serverUsage } from "./server-options.ts";
import { isVersionRequest, version } from "./version.ts";

async function main(): Promise<void> {
	const args = process.argv.slice(2);

	if (isVersionRequest(args)) {
		console.log(version);
	} else if (args[0] === "service" || args[0] === "autostart") {
		const installAction = args[0] === "service" ? "install" : "enable";
		const uninstallAction = args[0] === "service" ? "uninstall" : "disable";
		if (
			args.length !== 2 ||
			(args[1] !== installAction && args[1] !== uninstallAction)
		) {
			throw new Error("usage: pi-ui service install|uninstall");
		}
		if (args[1] === installAction) {
			await enableServerAutostart();
			console.log("pi-ui service installed and started");
		} else {
			await disableServerAutostart();
			console.log("pi-ui service stopped and uninstalled");
		}
	} else {
		await importLoginShellEnvironment();
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

process.on("unhandledRejection", (error) => {
	console.error("Unhandled rejection", error);
});
process.on("uncaughtException", (error) => {
	console.error("Unhandled error", error);
});

main().catch((cause) => {
	console.error(cause);
	process.exitCode = 1;
});
