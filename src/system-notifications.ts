import { rmSync } from "node:fs";
import { stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { staticPath } from "./server/static-path.ts";

const notificationIconPath = staticPath("notification-icon.png");
let resolvedNotificationIconPath: Promise<string | undefined> | undefined;
let temporaryNotificationIconPath: string | undefined;

export type SessionDoneNotification = Readonly<{
	workspace: string;
	sessionPath?: string;
}>;

export async function notifySessionDone(details: SessionDoneNotification): Promise<void> {
	if (process.platform !== "linux") return;
	try {
		const iconPath = await linuxNotificationIconPath();
		if (!iconPath) return;
		const process = Bun.spawn(
			[
				"notify-send",
				"--app-name=pi-ui",
				`--icon=${iconPath}`,
				`--hint=string:x-canonical-private-synchronous:${notificationTag(details)}`,
				"--",
				"Session finished",
				details.workspace,
			],
			{ stdout: "ignore", stderr: "ignore" },
		);
		await process.exited;
	} catch {
		// Notifications are best-effort.
	}
}

function linuxNotificationIconPath(): Promise<string | undefined> {
	resolvedNotificationIconPath ??= resolveLinuxNotificationIconPath();
	return resolvedNotificationIconPath;
}

async function resolveLinuxNotificationIconPath(): Promise<string | undefined> {
	const home = process.env.HOME;
	const candidates = [
		home && `${home}/.local/share/icons/hicolor/scalable/apps/pi-ui.svg`,
		"/usr/local/share/icons/hicolor/scalable/apps/pi-ui.svg",
		"/usr/share/icons/hicolor/scalable/apps/pi-ui.svg",
	];
	for (const path of candidates) {
		if (!path) continue;
		try {
			if ((await stat(path)).isFile()) return path;
		} catch {
			// Try the next standard icon location.
		}
	}

	const source = Bun.file(notificationIconPath);
	if (!(await source.exists())) return undefined;
	const path = join(tmpdir(), `pi-ui-notification-${crypto.randomUUID()}.png`);
	await Bun.write(path, source);
	temporaryNotificationIconPath = path;
	process.once("exit", removeTemporaryNotificationIcon);
	return path;
}

function removeTemporaryNotificationIcon(): void {
	if (!temporaryNotificationIconPath) return;
	try {
		rmSync(temporaryNotificationIconPath);
	} catch {
		// Best-effort only during process teardown.
	}
	temporaryNotificationIconPath = undefined;
}

function notificationTag(details: SessionDoneNotification): string {
	return details.sessionPath ?? details.workspace;
}
