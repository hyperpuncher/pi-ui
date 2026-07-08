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

	// Hide menu on Windows/Linux, but keep macOS' default application menu so
	// native shortcuts like Cmd+Q and Cmd+W keep working.
	if (Deno.build.os !== "darwin") {
		win.setApplicationMenu([]);
	}
}
