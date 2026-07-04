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

	win.setApplicationMenu([
		{
			submenu: {
				label: "App",
				items: [{ role: { role: "quit" } }],
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
		{
			submenu: {
				label: "View",
				items: [
					{
						item: {
							label: "Open DevTools",
							id: "devtools",
							accelerator: "F12",
							enabled: true,
						},
					},
				],
			},
		},
	]);

	win.addEventListener("menuclick", (event) => {
		if (menuId(event) === "devtools") {
			win.openDevtools();
		}
	});
}

function menuId(event: unknown): string | undefined {
	const detail = (event as { detail?: { id?: string } }).detail;
	return detail?.id;
}
