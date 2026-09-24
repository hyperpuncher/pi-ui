export const defaultServerHostname = "127.0.0.1";
export const defaultServerPort = 31415;
const loopbackHostnames = new Set(["127.0.0.1", "::1", "localhost"]);

export type ServerOptions = {
	hostname: string;
	port: number;
	help: boolean;
	/**
	 * Bearer token gating every request (see request-auth.ts), opt-in via `--auth-token`
	 * / `PI_UI_AUTH_TOKEN`. Absent by default, including on loopback, so a bare `pi-ui`
	 * keeps working exactly as before.
	 */
	authToken?: string;
};

export type ServerEnvironment = {
	host?: string;
	port?: string;
	authToken?: string;
};

/** A non-loopback hostname reaches every device on the LAN — see request-auth.ts. */
export function isLoopbackHostname(hostname: string): boolean {
	return loopbackHostnames.has(hostname.toLowerCase());
}

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
	let authToken = nonEmpty(environment.authToken);

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
		if (argument === "--auth-token") {
			authToken = parseAuthToken(args[++index], argument);
			continue;
		}
		if (argument.startsWith("--auth-token=")) {
			authToken = parseAuthToken(
				argument.slice("--auth-token=".length),
				"--auth-token",
			);
			continue;
		}
		throw new Error(`unknown option: ${argument}`);
	}

	const options: ServerOptions = { hostname, port, help };
	if (authToken) options.authToken = authToken;
	return options;
}

export const serverUsage = `usage: pi-ui [options]
       pi-ui service install|uninstall

options:
      --host <hostname>     listen hostname (default: ${defaultServerHostname}; env: PI_UI_HOST)
      --port <port>         listen port (default: ${defaultServerPort}; env: PI_UI_PORT)
      --auth-token <token>  require this bearer token on every request (env: PI_UI_AUTH_TOKEN).
                            Strongly recommended with --host set to anything other than
                            127.0.0.1/::1/localhost, since that exposes pi-ui to your whole
                            LAN. Open http://<host>:<port>/?token=<token> once per browser;
                            pi-ui remembers it in a cookie after that.
      --version             show the version
  -h, --help                show this help`;

function parseHostname(value: string | undefined, source: string): string {
	const hostname = value?.trim();
	if (!hostname) throw new Error(`${source} requires a non-empty hostname`);
	return hostname;
}

function parseAuthToken(value: string | undefined, source: string): string {
	const token = value?.trim();
	if (!token) throw new Error(`${source} requires a non-empty token`);
	return token;
}

function nonEmpty(value: string | undefined): string | undefined {
	const trimmed = value?.trim();
	return trimmed ? trimmed : undefined;
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
