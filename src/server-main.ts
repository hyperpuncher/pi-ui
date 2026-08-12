import { disableServerAutostart, enableServerAutostart } from "./server-autostart.ts";

if (Deno.args[0] === "autostart") {
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
	if (Deno.args.length > 0) {
		throw new Error("usage: pi-ui-server [autostart enable|disable]");
	}
	const { createApp } = await import("./server/app.ts");
	const app = await createApp();
	Deno.serve({ hostname: "127.0.0.1", port: 31415 }, app.fetch);
}
