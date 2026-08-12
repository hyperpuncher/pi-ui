import { spawn } from "node:child_process";

export async function openWithDefaultApp(target: string): Promise<void> {
	const [command, args]: [string, string[]] =
		Deno.build.os === "darwin"
			? ["open", [target]]
			: Deno.build.os === "windows"
				? ["rundll32", ["url.dll,FileProtocolHandler", target]]
				: ["xdg-open", [target]];

	await new Promise<void>((resolve, reject) => {
		const child = spawn(command, args, { stdio: "ignore", detached: true });
		child.once("error", reject);
		child.once("spawn", () => {
			child.unref();
			resolve();
		});
	});
}
