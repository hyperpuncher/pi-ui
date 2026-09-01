import { operatingSystem } from "./platform.ts";

export async function openWithDefaultApp(target: string): Promise<void> {
	const [command, ...args] =
		operatingSystem === "darwin"
			? ["open", target]
			: operatingSystem === "windows"
				? ["rundll32", "url.dll,FileProtocolHandler", target]
				: ["xdg-open", target];
	const child = Bun.spawn([command, ...args], {
		stdin: "ignore",
		stdout: "ignore",
		stderr: "pipe",
	});
	const [exitCode, stderr] = await Promise.all([
		child.exited,
		new Response(child.stderr).text(),
	]);
	if (exitCode !== 0) {
		throw new Error(stderr.trim() || `${command} exited with code ${exitCode}`);
	}
}
