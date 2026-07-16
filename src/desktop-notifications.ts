let applicationFocused = true;

const notificationIconBytesPromise = Deno.readFile(
	new URL("../static/notification-icon.png", import.meta.url),
).catch(() => undefined);
const notificationIconPromise = notificationIconBytesPromise.then((bytes) =>
	bytes ? `data:image/png;base64,${bytes.toBase64()}` : undefined,
);
let linuxNotificationIconPathPromise: Promise<string | undefined> | undefined;
let temporaryLinuxNotificationIconPath: string | undefined;

export type SessionDoneNotification = Readonly<{
	workspace: string;
	sessionPath?: string;
}>;

export function setApplicationFocused(focused: boolean): void {
	applicationFocused = focused;
}

export function isApplicationFocused(): boolean {
	return applicationFocused;
}

export async function notifySessionDone(details: SessionDoneNotification): Promise<void> {
	if (Deno.build.os === "linux" && (await notifyLinux(details))) return;
	if (typeof Notification !== "function") return;
	try {
		if (Notification.permission !== "granted") {
			const permission = await Notification.requestPermission();
			if (permission !== "granted") return;
		}
		const icon = await notificationIconPromise;
		new Notification(notificationTitle(), {
			body: notificationBody(details),
			tag: notificationTag(details),
			icon,
		});
	} catch {
		// Notifications are best-effort.
	}
}

async function notifyLinux(details: SessionDoneNotification): Promise<boolean> {
	try {
		const iconPath = await linuxNotificationIconPath();
		if (!iconPath) return false;
		const status = await new Deno.Command("notify-send", {
			args: [
				"--app-name=pi-ui",
				`--icon=${iconPath}`,
				`--hint=string:x-canonical-private-synchronous:${notificationTag(details)}`,
				"--",
				notificationTitle(),
				notificationBody(details),
			],
			stdout: "null",
			stderr: "null",
		}).output();
		return status.success;
	} catch {
		return false;
	}
}

function linuxNotificationIconPath(): Promise<string | undefined> {
	linuxNotificationIconPathPromise ??= resolveLinuxNotificationIconPath();
	return linuxNotificationIconPathPromise;
}

async function resolveLinuxNotificationIconPath(): Promise<string | undefined> {
	const home = Deno.env.get("HOME");
	const candidates = [
		home && `${home}/.local/share/icons/hicolor/scalable/apps/pi-ui.svg`,
		"/usr/local/share/icons/hicolor/scalable/apps/pi-ui.svg",
		"/usr/share/icons/hicolor/scalable/apps/pi-ui.svg",
	];
	for (const path of candidates) {
		if (!path) continue;
		try {
			if ((await Deno.stat(path)).isFile) return path;
		} catch {
			// Try the next standard icon location.
		}
	}

	const bytes = await notificationIconBytesPromise;
	if (!bytes) return undefined;
	const path = await Deno.makeTempFile({
		prefix: "pi-ui-notification-",
		suffix: ".png",
	});
	await Deno.writeFile(path, bytes);
	temporaryLinuxNotificationIconPath = path;
	addEventListener("unload", removeTemporaryLinuxNotificationIcon, { once: true });
	return path;
}

function removeTemporaryLinuxNotificationIcon(): void {
	if (!temporaryLinuxNotificationIconPath) return;
	try {
		Deno.removeSync(temporaryLinuxNotificationIconPath);
	} catch {
		// Best-effort only during process teardown.
	}
	temporaryLinuxNotificationIconPath = undefined;
}

function notificationTitle(): string {
	return "Session finished";
}

function notificationBody(details: SessionDoneNotification): string {
	return details.workspace;
}

function notificationTag(details: SessionDoneNotification): string {
	return details.sessionPath ?? details.workspace;
}
