import {
	setApplicationFocused,
	setApplicationFocusProbe,
} from "./desktop-notifications.ts";
import { createApp } from "./server/app.ts";

const hideApplicationMenuId = "hide-application";
const openWorkspaceMenuId = "change-workspace";
const quitApplicationMenuId = "quit-application";
const openWorkspaceDialogScript = "window.piUi.dialogs.openWorkspace()";

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
		transparentTitlebar: true,
	});

	const openWorkspaceDialog = () => {
		void win.executeJs(openWorkspaceDialogScript).catch(() => {});
	};

	setApplicationFocusProbe(async () => {
		if (win.isClosed() || !win.isVisible()) return false;
		return (await win.executeJs("document.hasFocus()")) === true;
	});
	win.addEventListener("focus", () => setApplicationFocused(true));
	win.addEventListener("blur", () => setApplicationFocused(false));

	win.addEventListener("keydown", (event) => {
		if (event.altKey || event.shiftKey) {
			return;
		}

		if ((event.ctrlKey || event.metaKey) && event.key === "/") {
			event.preventDefault();
			openWorkspaceDialog();
			return;
		}

		if (Deno.build.os !== "darwin" || !event.metaKey || event.ctrlKey) {
			return;
		}

		if (event.key.toLowerCase() === "h") {
			event.preventDefault();
			setApplicationFocused(false);
			win.hide();
		} else if (event.key.toLowerCase() === "q") {
			event.preventDefault();
			Deno.exit(0);
		}
	});

	win.addEventListener("menuclick", (event) => {
		switch (event.detail.id) {
			case hideApplicationMenuId:
				setApplicationFocused(false);
				win.hide();
				break;
			case openWorkspaceMenuId:
				openWorkspaceDialog();
				break;
			case quitApplicationMenuId:
				Deno.exit(0);
		}
	});

	if (Deno.build.os === "darwin") {
		win.setApplicationMenu(macosApplicationMenu());
		Deno.dock.addEventListener("reopen", (event) => {
			if (!event.detail.hasVisibleWindows) {
				win.show();
			}
		});
	}
}

function macosApplicationMenu(): Deno.MenuItem[] {
	return [
		{
			submenu: {
				label: "pi-ui",
				items: [
					{
						item: {
							label: "Hide pi-ui",
							id: hideApplicationMenuId,
							accelerator: "Cmd+H",
							enabled: true,
						},
					},
					{
						item: {
							label: "Quit pi-ui",
							id: quitApplicationMenuId,
							accelerator: "Cmd+Q",
							enabled: true,
						},
					},
				],
			},
		},
		{
			submenu: {
				label: "File",
				items: [workspaceMenuItem()],
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

function workspaceMenuItem(): Deno.MenuItem {
	return {
		item: {
			label: "Change Workspace…",
			id: openWorkspaceMenuId,
			enabled: true,
		},
	};
}
