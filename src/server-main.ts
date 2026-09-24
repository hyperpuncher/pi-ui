import { existsSync } from "node:fs";
import { basename, join } from "node:path";

import { importLoginShellEnvironment } from "./login-shell-environment.ts";
import { disableServerAutostart, enableServerAutostart } from "./server-autostart.ts";
import { isLoopbackHostname, parseServerOptions, serverUsage } from "./server-options.ts";
import { withAuthToken } from "./server/request-auth.ts";
import { isVersionRequest, version } from "./version.ts";

// Bun decides "jsx"/"jsxImportSource" from a tsconfig.json in process.cwd() once, at
// process startup — not from this file's own directory, not by walking up parent
// directories, and not retroactively via process.chdir() once the process is already
// running (all verified empirically; a chdir() here has no effect on it). Running
// `bun src/server-main.ts` directly (bypassing the "dev" package.json script, which `bun
// run` always executes with cwd already at the repo root — also verified) from any other
// directory silently drops the JSX transform: every page.tsx element becomes a plain
// object, and the whole app renders as the literal string "<!doctype html>[object Object]"
// instead of failing loudly. The published npm package and the `bun build --compile`
// executable are pre-bundled ahead of time, so their JSX is already plain JS by the time
// this runs and neither can hit this. Detected by this file living directly in a "src"
// directory next to a tsconfig.json, true only for the raw-source entry point, never the
// built outputs — so re-exec with the right --cwd only in that one narrow, unsupported case.
if (basename(import.meta.dir) === "src") {
	const projectRoot = join(import.meta.dir, "..");
	if (existsSync(join(projectRoot, "tsconfig.json")) && process.cwd() !== projectRoot) {
		const child = Bun.spawn({
			cmd: [
				process.execPath,
				`--cwd=${projectRoot}`,
				import.meta.path,
				...process.argv.slice(2),
			],
			stdio: ["inherit", "inherit", "inherit"],
			env: process.env,
		});
		for (const signal of ["SIGINT", "SIGTERM"] as const) {
			process.once(signal, () => child.kill(signal));
		}
		process.exit(await child.exited);
	}
}

type LazyAppRoutes = (typeof import("./server/lazy-app.ts"))["routes"];

function gateRoutes(routes: LazyAppRoutes, token: string): LazyAppRoutes {
	// SAFETY: Object.fromEntries widens back to a plain string-keyed record; this rebuilds
	// `routes` with the exact same pathname/method keys and one handler wrapped per entry,
	// so the shape is still LazyAppRoutes.
	return Object.fromEntries(
		Object.entries(routes).map(([pathname, methods]) => [
			pathname,
			Object.fromEntries(
				Object.entries(methods).map(([method, handler]) => [
					method,
					withAuthToken(handler, token),
				]),
			),
		]),
	) as LazyAppRoutes;
}

async function main(): Promise<void> {
	const args = process.argv.slice(2);

	if (isVersionRequest(args)) {
		console.log(version);
	} else if (args[0] === "service" || args[0] === "autostart") {
		const installAction = args[0] === "service" ? "install" : "enable";
		const uninstallAction = args[0] === "service" ? "uninstall" : "disable";
		if (
			args.length !== 2 ||
			(args[1] !== installAction && args[1] !== uninstallAction)
		) {
			throw new Error("usage: pi-ui service install|uninstall");
		}
		if (args[1] === installAction) {
			await enableServerAutostart();
			console.log("pi-ui service installed and started");
		} else {
			await disableServerAutostart();
			console.log("pi-ui service stopped and uninstalled");
		}
	} else {
		await importLoginShellEnvironment();
		const options = parseServerOptions(args, {
			host: process.env.PI_UI_HOST,
			port: process.env.PI_UI_PORT,
			authToken: process.env.PI_UI_AUTH_TOKEN,
		});
		if (options.help) {
			console.log(serverUsage);
		} else {
			const { disposeApp, fallback, routes } = await import("./server/lazy-app.ts");
			if (!options.authToken && !isLoopbackHostname(options.hostname)) {
				console.warn(
					`pi-ui is listening on ${options.hostname}, which is reachable from ` +
						"other devices on this network, without an auth token. Anyone who " +
						"can reach it can use it as you. Pass --auth-token <token> (or set " +
						"PI_UI_AUTH_TOKEN) to require one.",
				);
			}
			const server = Bun.serve({
				hostname: options.hostname,
				port: options.port,
				idleTimeout: 0,
				routes: options.authToken
					? gateRoutes(routes, options.authToken)
					: routes,
				fetch: options.authToken
					? withAuthToken(fallback, options.authToken)
					: fallback,
			});
			let stopping = false;
			const stop = async () => {
				if (stopping) return;
				stopping = true;
				await server.stop();
				await disposeApp();
			};
			process.once("SIGINT", () => void stop());
			process.once("SIGTERM", () => void stop());
			console.log(`pi-ui listening on ${server.url}`);
		}
	}
}

process.on("unhandledRejection", (error) => {
	console.error("Unhandled rejection", error);
});
process.on("uncaughtException", (error) => {
	console.error("Unhandled error", error);
});

main().catch((cause) => {
	console.error(cause);
	process.exitCode = 1;
});
