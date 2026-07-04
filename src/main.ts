import { appCommands, shortcutKeys, type AppCommandId } from "./commands/registry.ts";
import { createApp } from "./server/app.ts";

const app = await createApp();
Deno.serve(app.fetch);
setupDesktopWindow();

type BrowserWindowConstructor = new (options?: {
	title?: string;
	width?: number;
	height?: number;
}) => BrowserWindowLike;

type BrowserWindowLike = {
	addEventListener(type: string, listener: (event: unknown) => void): void;
	setApplicationMenu(items: unknown[]): void;
	executeJs(script: string): Promise<unknown>;
	openDevtools(options?: { deno?: boolean; renderer?: boolean }): void;
};

type DesktopKeyboardEvent = {
	key: string;
	ctrlKey?: boolean;
	metaKey?: boolean;
	preventDefault(): void;
};

type DesktopDeno = typeof Deno & {
	BrowserWindow?: BrowserWindowConstructor;
};

function setupDesktopWindow(): void {
	const BrowserWindow = (Deno as DesktopDeno).BrowserWindow;
	if (!BrowserWindow) {
		return;
	}

	const win = new BrowserWindow({
		title: "pi-ui",
		width: 1120,
		height: 820,
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
				label: "File",
				items: appCommands.map((command) => ({
					item: {
						label: command.title,
						id: command.id,
						accelerator: command.shortcut.native,
						enabled: true,
					},
				})),
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
		const id = menuId(event);
		if (isAppCommandId(id)) {
			void executeAppCommand(win, id);
		}
		if (id === "devtools") {
			win.openDevtools();
		}
	});

	win.addEventListener("keydown", (event) => {
		const keyEvent = event as DesktopKeyboardEvent;
		if (!(keyEvent.ctrlKey || keyEvent.metaKey)) {
			return;
		}
		const key = keyEvent.key.toLowerCase();
		if (shortcutKeys().includes(key)) {
			keyEvent.preventDefault();
		}
	});
}

async function executeAppCommand(
	win: BrowserWindowLike,
	command: AppCommandId,
): Promise<void> {
	const script = `globalThis.__piUiCommand?.(${JSON.stringify(command)})`;
	await win.executeJs(script).catch(() => undefined);
}

function menuId(event: unknown): string | undefined {
	const detail = (event as { detail?: { id?: string } }).detail;
	return detail?.id;
}

function isAppCommandId(id: string | undefined): id is AppCommandId {
	return appCommands.some((command) => command.id === id);
}
