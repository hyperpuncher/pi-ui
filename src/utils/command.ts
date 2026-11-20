export type CommandOutput = Readonly<{
	code: number;
	stdout: Uint8Array;
	stderr: Uint8Array;
	success: boolean;
	timedOut: boolean;
	exceededMaxOutput?: boolean;
}>;

type OutputCommandOptions = Readonly<{
	args?: string[];
	cwd?: string;
	env?: Record<string, string>;
	maxOutputBytes?: number;
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
	const stdoutPromise =
		options.maxOutputBytes === undefined
			? new Response(child.stdout)
					.bytes()
					.then((bytes) => ({ bytes, exceeded: false }))
			: readBounded(child.stdout, options.maxOutputBytes, () => child.kill());
	const [stdoutResult, stderr, code] = await Promise.all([
		stdoutPromise,
		new Response(child.stderr).bytes(),
		child.exited,
	]);
	return {
		code,
		stdout: stdoutResult.bytes,
		stderr,
		success: !stdoutResult.exceeded && code === 0,
		// A timeout kills the process with SIGTERM unless the caller aborted or exceeded output first.
		timedOut:
			!stdoutResult.exceeded &&
			options.timeout !== undefined &&
			child.signalCode === "SIGTERM" &&
			!options.signal?.aborted,
		exceededMaxOutput: stdoutResult.exceeded,
	};
}

async function readBounded(
	stream: ReadableStream<Uint8Array>,
	maxBytes: number,
	onExceed: () => void,
): Promise<{ bytes: Uint8Array; exceeded: boolean }> {
	const reader = stream.getReader();
	const chunks: Uint8Array[] = [];
	let total = 0;
	try {
		while (true) {
			const { done, value } = await reader.read();
			if (done) break;
			total += value.byteLength;
			if (total > maxBytes) {
				onExceed();
				await reader.cancel().catch(() => {});
				return { bytes: new Uint8Array(), exceeded: true };
			}
			chunks.push(value);
		}
		return { bytes: Buffer.concat(chunks, total), exceeded: false };
	} finally {
		reader.releaseLock();
	}
}
