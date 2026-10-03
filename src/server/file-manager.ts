import { pathToFileURL } from "node:url";

import { openBrowser } from "../../node_modules/@earendil-works/pi-coding-agent/dist/utils/open-browser.js";
import { outputCommand } from "../utils/command.ts";
import { operatingSystem, type OperatingSystem } from "../utils/platform.ts";

function isLoopback(address: string): boolean {
	return (
		address === "localhost" ||
		address === "::1" ||
		address === "[::1]" ||
		address === "::ffff:127.0.0.1" ||
		/^127(?:\.\d{1,3}){3}$/.test(address)
	);
}

/** A loopback connection is local unless it is tunneled or proxied. */
export function canRevealFiles(
	request: Request,
	clientAddress: string | undefined,
): boolean {
	if (
		!clientAddress ||
		!isLoopback(clientAddress) ||
		!isLoopback(new URL(request.url).hostname)
	)
		return false;
	if (request.headers.has("forwarded") || request.headers.has("x-forwarded-for"))
		return false;
	if (operatingSystem === "linux") {
		return Boolean(
			(process.env.DISPLAY || process.env.WAYLAND_DISPLAY) && Bun.which("gdbus"),
		);
	}
	return true;
}

export function revealFileCommand(
	path: string,
	platform: OperatingSystem = operatingSystem,
): [string, ...string[]] {
	if (platform === "darwin") return ["open", "-R", path];
	if (platform === "windows") return ["explorer.exe", `/select,${path}`];
	return [
		"gdbus",
		"call",
		"--session",
		"--dest",
		"org.freedesktop.FileManager1",
		"--object-path",
		"/org/freedesktop/FileManager1",
		"--method",
		"org.freedesktop.FileManager1.ShowItems",
		JSON.stringify([pathToFileURL(path).href]),
		"",
	];
}

export async function revealFile(path: string, directory: boolean): Promise<void> {
	if (directory) {
		openBrowser(path);
		return;
	}
	const [command, ...args] = revealFileCommand(path);
	const output = await outputCommand(command, { args, timeout: 5_000 });
	if (!output.success) throw new Error("Could not open the file manager.");
}
