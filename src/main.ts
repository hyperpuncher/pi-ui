import { createApp } from "./server/app.ts";

const openWorkspaceMenuId = "change-workspace";
const openWorkspaceDialogScript = `(() => {
	const input = document.getElementById("workspace-input");
	if (input instanceof HTMLInputElement) {
		input.value = "";
		input.dispatchEvent(new Event("input", { bubbles: true }));
	}
	const dialog = document.getElementById("workspace-dialog");
	if (dialog instanceof HTMLDialogElement && !dialog.open) {
		dialog.showModal();
	}
	requestAnimationFrame(() => input?.focus());
})()`;

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

	const openWorkspaceDialog = () => {
		void win.executeJs(openWorkspaceDialogScript).catch(() => {});
	};

	win.addEventListener("keydown", (event) => {
		if (
			(event.ctrlKey || event.metaKey) &&
			!event.altKey &&
			!event.shiftKey &&
			event.key === "/"
		) {
			event.preventDefault();
			openWorkspaceDialog();
		}
	});

	win.addEventListener("menuclick", (event) => {
		if (event.detail.id === openWorkspaceMenuId) {
			openWorkspaceDialog();
		}
	});

	win.setApplicationMenu(
		Deno.build.os === "darwin" ? macosApplicationMenu() : applicationMenu(),
	);
}

function applicationMenu(): Deno.MenuItem[] {
	return [
		{
			submenu: {
				label: "File",
				items: [workspaceMenuItem()],
			},
		},
	];
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
