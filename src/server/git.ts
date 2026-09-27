import { type CommandOutput, outputCommand } from "../utils/command.ts";
import { isNotFound } from "../utils/fs-errors.ts";

/** Bounds a hung git command; a large checkout is the slowest legitimate case. */
const gitTimeoutMs = 300_000;

const decoder = new TextDecoder();
const emptyOutput = new Uint8Array();
const gitNotFound = new TextEncoder().encode("Git executable not found.");

/**
 * Runs git in `cwd` with stable, machine-readable output settings. Returns raw
 * bytes so callers can hash or NUL-split exact output; use `gitText` to decode.
 */
export async function runGit(
	cwd: string,
	args: readonly string[],
	options: { stdin?: Uint8Array } = {},
): Promise<CommandOutput> {
	try {
		return await outputCommand("git", {
			args: ["-C", cwd, "-c", "core.quotePath=false", ...args],
			env: { GIT_OPTIONAL_LOCKS: "0" },
			stdin: options.stdin,
			timeout: gitTimeoutMs,
		});
	} catch (error) {
		if (!isNotFound(error)) throw error;
		return {
			code: 127,
			stdout: emptyOutput,
			stderr: gitNotFound,
			success: false,
			timedOut: false,
		};
	}
}

export function gitText(bytes: Uint8Array): string {
	return decoder.decode(bytes);
}

export type { CommandOutput };
