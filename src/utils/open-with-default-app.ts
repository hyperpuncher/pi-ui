import { operatingSystem } from "./platform.ts";

export function openWithDefaultApp(target: string): Promise<void> {
	const [command, ...args] =
		operatingSystem === "darwin"
			? ["open", target]
			: operatingSystem === "windows"
				? ["rundll32", "url.dll,FileProtocolHandler", target]
				: ["xdg-open", target];
	const child = Bun.spawn([command, ...args], {
		stdin: "ignore",
		stdout: "ignore",
		stderr: "ignore",
	});
	child.unref();
	return Promise.resolve();
}
