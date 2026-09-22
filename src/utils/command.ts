export type CommandOutput = Readonly<{
	code: number;
	stdout: Uint8Array;
	stderr: Uint8Array;
	success: boolean;
	timedOut: boolean;
}>;

type OutputCommandOptions = Readonly<{
	args?: string[];
	cwd?: string;
	env?: Record<string, string>;
	signal?: AbortSignal;
	stdin?: Uint8Array;
	timeout?: number;
}>;

export async function outputCommand(
	command: string,
	options: OutputCommandOptions = {},
): Promise<CommandOutput> {
	const child = Bun.spawn([command, ...(options.args ?? [])], {
		cwd: options.cwd,
		env: { ...process.env, ...options.env },
		stdin: options.stdin ?? "ignore",
		stdout: "pipe",
		stderr: "pipe",
		windowsHide: true,
		signal: options.signal,
		timeout: options.timeout,
	});
	const [stdout, stderr, code] = await Promise.all([
		new Response(child.stdout).bytes(),
		new Response(child.stderr).bytes(),
		child.exited,
	]);
	return {
		code,
		stdout,
		stderr,
		success: code === 0,
		// A timeout kills the process with SIGTERM unless the caller aborted first.
		timedOut:
			options.timeout !== undefined &&
			child.signalCode === "SIGTERM" &&
			!options.signal?.aborted,
	};
}
