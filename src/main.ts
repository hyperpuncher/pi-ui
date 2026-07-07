import { createApp } from "./server/app.ts";

const app = await createApp();
Deno.serve(app.fetch);
setupDesktopWindow();

function setupDesktopWindow(): void {
	const BrowserWindow = Deno.BrowserWindow;
	if (!BrowserWindow) {
		return;
	}

	const win = new BrowserWindow({
		title: "pi-ui",
		width: 1000,
		height: 1400,
	});

	win.setApplicationMenu([]);
}
