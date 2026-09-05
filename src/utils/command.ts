export type CommandOutput = Readonly<{
	code: number;
	stdout: Uint8Array;
	stderr: Uint8Array;
	success: boolean;
}>;

type OutputCommandOptions = Readonly<{
	args?: string[];
	env?: Record<string, string>;
	signal?: AbortSignal;
	stdin?: Uint8Array;
}>;

export async function outputCommand(
	command: string,
	options: OutputCommandOptions = {},
): Promise<CommandOutput> {
	const child = Bun.spawn([command, ...(options.args ?? [])], {
		env: { ...process.env, ...options.env },
		stdin: options.stdin ?? "ignore",
		stdout: "pipe",
		stderr: "pipe",
		windowsHide: true,
		signal: options.signal,
	});
	const [stdout, stderr, code] = await Promise.all([
		new Response(child.stdout).bytes(),
		new Response(child.stderr).bytes(),
		child.exited,
	]);
	return { code, stdout, stderr, success: code === 0 };
}
