import { disableServerAutostart, enableServerAutostart } from "./server-autostart.ts";
import { parseServerOptions, serverUsage } from "./server-options.ts";
import { isVersionRequest, version } from "./version.ts";

if (isVersionRequest(Deno.args)) {
	console.log(version);
} else if (Deno.args[0] === "autostart") {
	if (Deno.args.length !== 2 || !["enable", "disable"].includes(Deno.args[1])) {
		throw new Error("usage: pi-ui-server autostart enable|disable");
	}
	if (Deno.args[1] === "enable") {
		await enableServerAutostart();
		console.log("pi-ui server will start automatically at login");
	} else {
		await disableServerAutostart();
		console.log("pi-ui server will no longer start automatically at login");
	}
} else {
	const options = parseServerOptions(Deno.args, {
		host: Deno.env.get("PI_UI_HOST"),
		port: Deno.env.get("PI_UI_PORT"),
	});
	if (options.help) {
		console.log(serverUsage);
	} else {
		const [{ createApp }, { compressSseResponse }] = await Promise.all([
			import("./server/app.ts"),
			import("./server/compression.ts"),
		]);
		const app = await createApp();
		Deno.serve(
			{
				hostname: options.hostname,
				port: options.port,
				automaticCompression: true,
			},
			async (request, info) =>
				compressSseResponse(request, await app.fetch(request, info)),
		);
	}
}
