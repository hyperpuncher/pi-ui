import { userInfo } from "node:os";

const environmentCommand = "printf '\\0'; command env -0; printf '\\0'";

type Environment = NodeJS.ProcessEnv;

type LoginShellEnvironmentOptions = Readonly<{
	environment?: Environment;
	isTerminal?: boolean;
	platform?: NodeJS.Platform;
	readOutput?: (shell: string, environment: Environment) => Promise<string | undefined>;
}>;

export async function importLoginShellEnvironment(
	options: LoginShellEnvironmentOptions = {},
): Promise<void> {
	const environment = options.environment ?? process.env;
	const platform = options.platform ?? process.platform;
	const isTerminal = options.isTerminal ?? Boolean(process.stdin.isTTY);
	if (platform === "win32" || isTerminal) return;

	const shell = environment.SHELL ?? userInfo().shell;
	if (!shell) return;

	const output = await (options.readOutput ?? readLoginShellOutput)(shell, environment);
	if (output !== undefined) Object.assign(environment, parseEnvironment(output));
}

async function readLoginShellOutput(
	shell: string,
	environment: Environment,
): Promise<string | undefined> {
	try {
		const child = Bun.spawn([shell, "-ilc", environmentCommand], {
			env: environment,
			stdin: "ignore",
			stdout: "pipe",
			stderr: "ignore",
			timeout: 5000,
		});
		const [exitCode, output] = await Promise.all([
			child.exited,
			new Response(child.stdout).text(),
		]);
		return exitCode === 0 ? output : undefined;
	} catch {
		return undefined;
	}
}

function parseEnvironment(output: string): Environment {
	const start = output.indexOf("\0");
	const end = output.indexOf("\0\0", start + 1);
	if (start < 0 || end < 0) return {};

	const environment: Environment = {};
	for (const entry of output.slice(start + 1, end).split("\0")) {
		const separator = entry.indexOf("=");
		if (separator <= 0) continue;
		environment[entry.slice(0, separator)] = entry.slice(separator + 1);
	}
	return environment;
}
