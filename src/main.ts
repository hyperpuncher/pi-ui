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

	if (Deno.build.os === "darwin") {
		win.setApplicationMenu(macosApplicationMenu());
		return;
	}

	win.setApplicationMenu([]);
}

function macosApplicationMenu(): Deno.MenuItem[] {
	return [
		{
			submenu: {
				label: "pi-ui",
				items: [{ role: { role: "quit" } }],
			},
		},
		{
			submenu: {
				label: "File",
				items: [{ role: { role: "close" } }],
			},
		},
		{
			submenu: {
				label: "Edit",
				items: [
					{ role: { role: "undo" } },
					{ role: { role: "redo" } },
					"separator",
					{ role: { role: "cut" } },
					{ role: { role: "copy" } },
					{ role: { role: "paste" } },
					{ role: { role: "selectAll" } },
				],
			},
		},
	];
}
