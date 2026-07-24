import { setApplicationFocused } from "./desktop-notifications.ts";
import { createApp } from "./server/app.ts";

const hideApplicationMenuId = "hide-application";
const openWorkspaceMenuId = "change-workspace";
const quitApplicationMenuId = "quit-application";
const toggleWorkspaceDialogScript = "window.piUi.dialogs.toggleWorkspace()";
const suspendWindowFocusScript = "window.piUi.windowFocus.suspend()";
const restoreWindowFocusScript = "window.piUi.windowFocus.restore()";

const app = await createApp();
Deno.serve(app.fetch);
setupDesktopWindow();

// Deno Desktop forces every later HTTP listener onto its UI server address
// while this variable is present. Release it after startup so OAuth providers
// can bind their fixed localhost callback ports.
Deno.env.delete("DENO_SERVE_ADDRESS");

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
		void win.executeJs("window.piUi.dialogs.openWorkspace()").catch(() => {});
	};
	const toggleWorkspaceDialog = () => {
		void win.executeJs(toggleWorkspaceDialogScript).catch(() => {});
	};

	win.addEventListener("focus", () => {
		setApplicationFocused(true);
		void win.executeJs(restoreWindowFocusScript).catch(() => {});
	});
	win.addEventListener("blur", () => {
		setApplicationFocused(false);
		// CEF can keep sending text input to a focused control while a fullscreen
		// macOS window is on another Space. Remove web focus until activation.
		void win.executeJs(suspendWindowFocusScript).catch(() => {});
	});

	win.addEventListener("keydown", (event) => {
		if (event.altKey || event.shiftKey) {
			return;
		}

		if ((event.ctrlKey || event.metaKey) && event.code === "Slash") {
			event.preventDefault();
			toggleWorkspaceDialog();
			return;
		}

		if (Deno.build.os !== "darwin" || !event.metaKey || event.ctrlKey) {
			return;
		}

		if (event.code === "KeyH") {
			event.preventDefault();
			setApplicationFocused(false);
			win.hide();
		} else if (event.code === "KeyQ") {
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
