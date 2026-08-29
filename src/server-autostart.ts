import { mkdir } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname } from "node:path";

import { outputCommand } from "./utils/command.ts";
import { isNotFound } from "./utils/fs-errors.ts";
import { operatingSystem } from "./utils/platform.ts";

const serviceName = "pi-ui";
const legacyServiceName = "pi-ui-server";
const launchAgentLabel = "dev.pi.ui";
const legacyLaunchAgentLabel = "dev.pi.ui.server";
const windowsRunKey = "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Run";

export type ServerAutostartPlatform = "linux" | "darwin" | "windows";

export type ServerAutostartConfig = {
	platform: ServerAutostartPlatform;
	executable: string;
	args?: readonly string[];
	home: string;
	uid?: number;
	transient?: boolean;
};

type ServerRuntime = Readonly<{
	executable: string;
	script?: string;
	standalone: boolean;
}>;

export function serverAutostartConfig(
	platform = operatingSystem,
	runtime: ServerRuntime = currentServerRuntime(),
): ServerAutostartConfig {
	if (platform !== "linux" && platform !== "darwin" && platform !== "windows") {
		throw new Error(`server autostart is not supported on ${platform}`);
	}
	const home = homedir();
	if (!home) throw new Error("could not determine the user home directory");
	const script = runtime.standalone ? undefined : runtime.script;
	if (!runtime.standalone && !script) {
		throw new Error("could not determine the pi-ui server script");
	}
	return {
		platform,
		executable: runtime.executable,
		args: script ? [script] : [],
		home,
		uid: platform === "darwin" ? process.getuid?.() : undefined,
		transient: script ? isBunxPath(script) : false,
	};
}

export async function enableServerAutostart(
	config = serverAutostartConfig(),
): Promise<void> {
	if (config.transient) {
		throw new Error(
			"bunx cannot install the background service. install pi-ui first with: bun i -g @hyperpuncher/pi-ui",
		);
	}
	switch (config.platform) {
		case "linux":
			await enableSystemdService(config);
			break;
		case "darwin":
			await enableLaunchAgent(config);
			break;
		case "windows":
			await enableWindowsAutostart(config);
			break;
	}
}

export async function disableServerAutostart(
	config = serverAutostartConfig(),
): Promise<void> {
	switch (config.platform) {
		case "linux":
			await disableSystemdService(config, serviceName);
			await disableSystemdService(config, legacyServiceName);
			await command("systemctl", ["--user", "daemon-reload"]);
			break;
		case "darwin":
			await disableLaunchAgent(config, launchAgentLabel);
			await disableLaunchAgent(config, legacyLaunchAgentLabel);
			break;
		case "windows":
			await disableWindowsAutostart(config);
			break;
	}
}

export function systemdService(config: ServerAutostartConfig): string {
	return `[Unit]
Description=pi-ui server

[Service]
ExecStart=${serverCommand(config).map(systemdArgument).join(" ")}
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
${serverCommand(config)
	.map((argument) => `\t\t<string>${xml(argument)}</string>`)
	.join("\n")}
	</array>
	<key>RunAtLoad</key>
	<true/>
	<key>KeepAlive</key>
	<dict>
		<key>SuccessfulExit</key>
		<false/>
	</dict>
	<key>StandardOutPath</key>
	<string>${xml(`${logs}/pi-ui.log`)}</string>
	<key>StandardErrorPath</key>
	<string>${xml(`${logs}/pi-ui.log`)}</string>
</dict>
</plist>
`;
}

export function windowsRunCommand(config: ServerAutostartConfig): string {
	const executable = powershellString(config.executable);
	const args = config.args ?? [];
	const argumentList = args.length
		? ` -ArgumentList @(${args.map((argument) => `'${powershellString(argument)}'`).join(", ")})`
		: "";
	return `powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -Command "Start-Process -WindowStyle Hidden -FilePath '${executable}'${argumentList}"`;
}

async function enableSystemdService(config: ServerAutostartConfig): Promise<void> {
	await disableSystemdService(config, legacyServiceName);
	const path = systemdServicePath(config, serviceName);
	await writeConfig(path, systemdService(config));
	await command("systemctl", ["--user", "daemon-reload"]);
	await command("systemctl", ["--user", "enable", `${serviceName}.service`]);
	await command("systemctl", ["--user", "restart", `${serviceName}.service`]);
}

async function disableSystemdService(
	config: ServerAutostartConfig,
	name: string,
): Promise<void> {
	await command("systemctl", ["--user", "disable", "--now", `${name}.service`], true);
	await removeIfPresent(systemdServicePath(config, name));
}

async function enableLaunchAgent(config: ServerAutostartConfig): Promise<void> {
	await disableLaunchAgent(config, legacyLaunchAgentLabel);
	const path = launchAgentPath(config, launchAgentLabel);
	await writeConfig(path, launchAgent(config));
	await command("launchctl", ["bootout", launchDomain(config), path], true);
	await command("launchctl", ["bootstrap", launchDomain(config), path]);
}

async function disableLaunchAgent(
	config: ServerAutostartConfig,
	label: string,
): Promise<void> {
	const path = launchAgentPath(config, label);
	await command("launchctl", ["bootout", launchDomain(config), path], true);
	await removeIfPresent(path);
}

async function enableWindowsAutostart(config: ServerAutostartConfig): Promise<void> {
	await removeWindowsAutostart(legacyServiceName);
	await stopLegacyWindowsServer();
	await stopWindowsServer(config);
	await command("reg.exe", [
		"ADD",
		windowsRunKey,
		"/V",
		serviceName,
		"/T",
		"REG_SZ",
		"/D",
		windowsRunCommand(config),
		"/F",
	]);
	const child = Bun.spawn(serverCommand(config), {
		stdin: "ignore",
		stdout: "ignore",
		stderr: "ignore",
		detached: true,
		windowsHide: true,
	});
	child.unref();
}

async function disableWindowsAutostart(config: ServerAutostartConfig): Promise<void> {
	await removeWindowsAutostart(serviceName);
	await removeWindowsAutostart(legacyServiceName);
	await stopLegacyWindowsServer();
	await stopWindowsServer(config);
}

async function removeWindowsAutostart(name: string): Promise<void> {
	await command("reg.exe", ["DELETE", windowsRunKey, "/V", name, "/F"], true);
	await command("schtasks.exe", ["/End", "/TN", name], true);
	await command("schtasks.exe", ["/Delete", "/TN", name, "/F"], true);
}

async function stopLegacyWindowsServer(): Promise<void> {
	await command("taskkill.exe", ["/F", "/IM", `${legacyServiceName}.exe`], true);
}

async function stopWindowsServer(config: ServerAutostartConfig): Promise<void> {
	const executable = powershellString(config.executable);
	const scriptPath = config.args?.[0];
	const commandMatch = scriptPath
		? ` -and $_.CommandLine -and $_.CommandLine.Contains('${powershellString(scriptPath)}')`
		: "";
	const script = `Get-CimInstance Win32_Process | Where-Object { $_.ProcessId -ne ${process.pid} -and $_.ExecutablePath -eq '${executable}'${commandMatch} } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force }`;
	await command("powershell.exe", [
		"-NoProfile",
		"-NonInteractive",
		"-Command",
		script,
	]);
}

function currentServerRuntime(): ServerRuntime {
	return {
		executable: process.execPath,
		script: process.argv[1],
		standalone: Bun.isStandaloneExecutable,
	};
}

function isBunxPath(path: string): boolean {
	const normalized = path.replaceAll("\\", "/");
	return (
		normalized.includes("/.bun/install/cache/") ||
		/(?:^|\/)bunx-[^/]+\//.test(normalized)
	);
}

function serverCommand(config: ServerAutostartConfig): string[] {
	return [config.executable, ...(config.args ?? [])];
}

function systemdServicePath(config: ServerAutostartConfig, name: string): string {
	return `${config.home}/.config/systemd/user/${name}.service`;
}

function launchAgentPath(config: ServerAutostartConfig, label: string): string {
	return `${config.home}/Library/LaunchAgents/${label}.plist`;
}

function launchDomain(config: ServerAutostartConfig): string {
	if (config.uid === undefined) throw new Error("could not determine the user id");
	return `gui/${config.uid}`;
}

async function writeConfig(path: string, contents: string): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	await Bun.write(path, contents);
}

async function removeIfPresent(path: string): Promise<void> {
	try {
		await Bun.file(path).delete();
	} catch (error) {
		if (!isNotFound(error)) throw error;
	}
}

async function command(
	name: string,
	args: string[],
	allowFailure = false,
): Promise<void> {
	const output = await outputCommand(name, { args });
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

function powershellString(value: string): string {
	return value.replaceAll("'", "''");
}

function xml(value: string): string {
	return value
		.replaceAll("&", "&amp;")
		.replaceAll("<", "&lt;")
		.replaceAll(">", "&gt;")
		.replaceAll('"', "&quot;")
		.replaceAll("'", "&apos;");
}
