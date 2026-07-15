let applicationFocused = true;
let applicationFocusProbe: (() => Promise<boolean>) | undefined;

const notificationIconBytesPromise = Deno.readFile(
	new URL("../static/notification-icon.png", import.meta.url),
).catch(() => undefined);
const notificationIconPromise = notificationIconBytesPromise.then((bytes) =>
	bytes ? `data:image/png;base64,${bytes.toBase64()}` : undefined,
);
export type SessionDoneNotification = Readonly<{
	workspace: string;
	sessionPath?: string;
}>;

export function setApplicationFocused(focused: boolean): void {
	applicationFocused = focused;
}

export function setApplicationFocusProbe(probe: () => Promise<boolean>): void {
	applicationFocusProbe = probe;
}

export async function isApplicationFocused(): Promise<boolean> {
	if (!applicationFocusProbe) return applicationFocused;
	try {
		return await applicationFocusProbe();
	} catch {
		return applicationFocused;
	}
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
	let iconPath: string | undefined;
	try {
		const bytes = await notificationIconBytesPromise;
		if (!bytes) return false;
		iconPath = await Deno.makeTempFile({
			prefix: "pi-ui-notification-",
			suffix: ".png",
		});
		await Deno.writeFile(iconPath, bytes);
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
	} finally {
		if (iconPath) await Deno.remove(iconPath).catch(() => {});
	}
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
