import { Buffer } from "node:buffer";
import { spawn } from "node:child_process";

type OutputCommandOptions = Readonly<{
	args?: string[];
	env?: Record<string, string>;
}>;

/** Runs a command without creating a visible console window on Windows. */
export async function outputCommand(
	command: string,
	options: OutputCommandOptions = {},
): Promise<Deno.CommandOutput> {
	if (Deno.build.os !== "windows") {
		return await new Deno.Command(command, options).output();
	}

	return await new Promise((resolve, reject) => {
		const stdout: Uint8Array[] = [];
		const stderr: Uint8Array[] = [];
		const child = spawn(command, options.args ?? [], {
			env: { ...Deno.env.toObject(), ...options.env },
			stdio: ["ignore", "pipe", "pipe"],
			windowsHide: true,
		});
		child.stdout.on("data", (chunk: Uint8Array) => stdout.push(chunk));
		child.stderr.on("data", (chunk: Uint8Array) => stderr.push(chunk));
		child.once("error", (error) => {
			const code = "code" in error ? error.code : undefined;
			reject(code === "ENOENT" ? new Deno.errors.NotFound(error.message) : error);
		});
		child.once("close", (code) => {
			resolve({
				code: code ?? 1,
				signal: null,
				stdout: Buffer.concat(stdout),
				stderr: Buffer.concat(stderr),
				success: code === 0,
			});
		});
	});
}
