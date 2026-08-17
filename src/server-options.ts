export const defaultServerHostname = "127.0.0.1";
export const defaultServerPort = 31415;

export type ServerOptions = {
	hostname: string;
	port: number;
	help: boolean;
};

export type ServerEnvironment = {
	host?: string;
	port?: string;
};

export function parseServerOptions(
	args: readonly string[],
	environment: ServerEnvironment = {},
): ServerOptions {
	let hostname =
		environment.host === undefined
			? defaultServerHostname
			: parseHostname(environment.host, "PI_UI_HOST");
	let port =
		environment.port === undefined
			? defaultServerPort
			: parsePort(environment.port, "PI_UI_PORT");
	let help = false;

	for (let index = 0; index < args.length; index += 1) {
		const argument = args[index];
		if (argument === "--help" || argument === "-h") {
			help = true;
			continue;
		}
		if (argument === "--host") {
			hostname = parseHostname(args[++index], argument);
			continue;
		}
		if (argument.startsWith("--host=")) {
			hostname = parseHostname(argument.slice("--host=".length), "--host");
			continue;
		}
		if (argument === "--port") {
			port = parsePort(args[++index], argument);
			continue;
		}
		if (argument.startsWith("--port=")) {
			port = parsePort(argument.slice("--port=".length), "--port");
			continue;
		}
		throw new Error(`unknown option: ${argument}`);
	}

	return { hostname, port, help };
}

export const serverUsage = `usage: pi-ui-server [options]
       pi-ui-server autostart enable|disable

options:
      --host <hostname>  listen hostname (default: ${defaultServerHostname}; env: PI_UI_HOST)
      --port <port>      listen port (default: ${defaultServerPort}; env: PI_UI_PORT)
      --version          show the version
  -h, --help             show this help`;

function parseHostname(value: string | undefined, source: string): string {
	const hostname = value?.trim();
	if (!hostname) throw new Error(`${source} requires a non-empty hostname`);
	return hostname;
}

function parsePort(value: string | undefined, source: string): number {
	if (!value || !/^\d+$/.test(value)) {
		throw new Error(`${source} must be an integer from 1 to 65535`);
	}
	const port = Number(value);
	if (port < 1 || port > 65535) {
		throw new Error(`${source} must be an integer from 1 to 65535`);
	}
	return port;
}
