import { dirname } from "@std/path";

const serviceName = "pi-ui-server";
const launchAgentLabel = "dev.pi.ui.server";

export type ServerAutostartPlatform = "linux" | "darwin" | "windows";

export type ServerAutostartConfig = {
	platform: ServerAutostartPlatform;
	executable: string;
	home: string;
	uid?: number;
};

export function serverAutostartConfig(platform = Deno.build.os): ServerAutostartConfig {
	if (platform !== "linux" && platform !== "darwin" && platform !== "windows") {
		throw new Error(`server autostart is not supported on ${platform}`);
	}
	const home = Deno.env.get(platform === "windows" ? "USERPROFILE" : "HOME");
	if (!home) throw new Error("could not determine the user home directory");
	return {
		platform,
		executable: Deno.execPath(),
		home,
		uid: platform === "darwin" ? (Deno.uid() ?? undefined) : undefined,
	};
}

export async function enableServerAutostart(
	config = serverAutostartConfig(),
): Promise<void> {
	switch (config.platform) {
		case "linux":
			await enableSystemdService(config);
			break;
		case "darwin":
			await enableLaunchAgent(config);
			break;
		case "windows":
			await enableScheduledTask(config);
			break;
	}
}

export async function disableServerAutostart(
	config = serverAutostartConfig(),
): Promise<void> {
	switch (config.platform) {
		case "linux": {
			await command(
				"systemctl",
				["--user", "disable", "--now", `${serviceName}.service`],
				true,
			);
			await removeIfPresent(systemdServicePath(config));
			await command("systemctl", ["--user", "daemon-reload"]);
			break;
		}
		case "darwin": {
			const path = launchAgentPath(config);
			await command("launchctl", ["bootout", launchDomain(config), path], true);
			await removeIfPresent(path);
			break;
		}
		case "windows":
			await command("schtasks.exe", ["/End", "/TN", serviceName], true);
			await command("schtasks.exe", ["/Delete", "/TN", serviceName, "/F"], true);
			break;
	}
}

export function systemdService(config: ServerAutostartConfig): string {
	return `[Unit]
Description=pi-ui server

[Service]
ExecStart=${systemdArgument(config.executable)}
Restart=on-failure
RestartSec=2

[Install]
WantedBy=default.target
`;
}

export function launchAgent(config: ServerAutostartConfig): string {
	const logs = `${config.home}/Library/Logs`;
	return `<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
	<key>Label</key>
	<string>${launchAgentLabel}</string>
	<key>ProgramArguments</key>
	<array>
		<string>${xml(config.executable)}</string>
	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>KeepAlive</key>
	<dict>
		<key>SuccessfulExit</key>
		<false/>
	</dict>
	<key>StandardOutPath</key>
	<string>${xml(`${logs}/pi-ui-server.log`)}</string>
	<key>StandardErrorPath</key>
	<string>${xml(`${logs}/pi-ui-server.log`)}</string>
</dict>
</plist>
`;
}

export function windowsTaskCommand(config: ServerAutostartConfig): string {
	return `"${config.executable}"`;
}

async function enableSystemdService(config: ServerAutostartConfig): Promise<void> {
	const path = systemdServicePath(config);
	await writeConfig(path, systemdService(config));
	await command("systemctl", ["--user", "daemon-reload"]);
	await command("systemctl", ["--user", "enable", `${serviceName}.service`]);
	await command("systemctl", ["--user", "restart", `${serviceName}.service`]);
}

async function enableLaunchAgent(config: ServerAutostartConfig): Promise<void> {
	const path = launchAgentPath(config);
	await writeConfig(path, launchAgent(config));
	await command("launchctl", ["bootout", launchDomain(config), path], true);
	await command("launchctl", ["bootstrap", launchDomain(config), path]);
}

async function enableScheduledTask(config: ServerAutostartConfig): Promise<void> {
	await command("schtasks.exe", [
		"/Create",
		"/TN",
		serviceName,
		"/SC",
		"ONLOGON",
		"/TR",
		windowsTaskCommand(config),
		"/RL",
		"LIMITED",
		"/F",
	]);
	await command("schtasks.exe", ["/Run", "/TN", serviceName]);
}

function systemdServicePath(config: ServerAutostartConfig): string {
	return `${config.home}/.config/systemd/user/${serviceName}.service`;
}

function launchAgentPath(config: ServerAutostartConfig): string {
	return `${config.home}/Library/LaunchAgents/${launchAgentLabel}.plist`;
}

function launchDomain(config: ServerAutostartConfig): string {
	if (config.uid === undefined) throw new Error("could not determine the user id");
	return `gui/${config.uid}`;
}

async function writeConfig(path: string, contents: string): Promise<void> {
	await Deno.mkdir(dirname(path), { recursive: true });
	await Deno.writeTextFile(path, contents);
}

async function removeIfPresent(path: string): Promise<void> {
	try {
		await Deno.remove(path);
	} catch (error) {
		if (!(error instanceof Deno.errors.NotFound)) throw error;
	}
}

async function command(
	name: string,
	args: string[],
	allowFailure = false,
): Promise<void> {
	const output = await new Deno.Command(name, { args }).output();
	if (output.success || allowFailure) return;
	const message = new TextDecoder().decode(output.stderr).trim();
	throw new Error(`${name} failed${message ? `: ${message}` : ""}`);
}

function systemdArgument(value: string): string {
	let result = "";
	for (const byte of new TextEncoder().encode(value)) {
		const character = String.fromCharCode(byte);
		result += /[A-Za-z0-9/_.-]/.test(character)
			? character
			: `\\x${byte.toString(16).padStart(2, "0")}`;
	}
	return result;
}

function xml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;");
}
