import { test } from "bun:test";

import {
	assertEquals,
	assertFalse,
	assertRejects,
	assertStringIncludes,
} from "#testing/assertions";

import {
	enableServerAutostart,
	launchAgent,
	serverAutostartConfig,
	systemdService,
	windowsRunCommand,
} from "./server-autostart.ts";

test("systemd service starts the current server executable", () => {
	const service = systemdService({
		platform: "linux",
		executable: "/home/Test User/.bun/bin/bun",
		args: ["/home/Test User/pi-ui%dev/server-main.js"],
		home: "/home/Test User",
	});

	assertStringIncludes(
		service,
		"ExecStart=/home/Test\\x20User/.bun/bin/bun /home/Test\\x20User/pi-ui\\x25dev/server-main.js",
	);
	assertStringIncludes(service, "After=graphical-session.target");
	assertStringIncludes(service, "PartOf=graphical-session.target");
	assertStringIncludes(service, "WantedBy=graphical-session.target");
});

test("launch agent starts at login and escapes paths", () => {
	const agent = launchAgent({
		platform: "darwin",
		executable: "/Users/test/.bun/bin/bun",
		args: ["/Users/test/pi-ui & dev/server-main.js"],
		home: "/Users/test",
		uid: 501,
	});

	assertStringIncludes(agent, "<string>dev.pi.ui</string>");
	assertStringIncludes(agent, "<key>RunAtLoad</key>");
	assertStringIncludes(agent, "/Library/Logs/pi-ui.log");
	assertStringIncludes(agent, "<key>KeepAlive</key>");
	assertStringIncludes(agent, "<key>SuccessfulExit</key>");
	assertStringIncludes(agent, "/Users/test/.bun/bin/bun");
	assertStringIncludes(agent, "/Users/test/pi-ui &amp; dev/server-main.js");
});

test("windows startup command launches the executable without a window", () => {
	assertEquals(
		windowsRunCommand({
			platform: "windows",
			executable: "C:\\Program Files\\pi-ui\\pi-ui.exe",
			home: "C:\\Users\\test",
		}),
		"powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -Command \"Start-Process -WindowStyle Hidden -FilePath 'C:\\Program Files\\pi-ui\\pi-ui.exe'\"",
	);
	assertEquals(
		windowsRunCommand({
			platform: "windows",
			executable: "C:\\Users\\test\\.bun\\bin\\bun.exe",
			args: ["C:\\Users\\test\\pi-ui's package\\server-main.js"],
			home: "C:\\Users\\test",
		}),
		"powershell.exe -NoProfile -NonInteractive -WindowStyle Hidden -Command \"Start-Process -WindowStyle Hidden -FilePath 'C:\\Users\\test\\.bun\\bin\\bun.exe' -ArgumentList @('C:\\Users\\test\\pi-ui''s package\\server-main.js')\"",
	);
});

test("autostart uses the standalone executable without arguments", () => {
	const config = serverAutostartConfig("linux", {
		executable: "/usr/bin/pi-ui",
		standalone: true,
	});

	assertEquals(config.executable, "/usr/bin/pi-ui");
	assertEquals(config.args, []);
	assertFalse(config.transient);
});

test("autostart runs a global bun package through its runtime", () => {
	const config = serverAutostartConfig("linux", {
		executable: "/home/test/.bun/bin/bun",
		script: "/home/test/.bun/install/global/node_modules/@hyperpuncher/pi-ui/dist/npm/server-main.js",
		standalone: false,
	});

	assertEquals(config.executable, "/home/test/.bun/bin/bun");
	assertEquals(config.args, [
		"/home/test/.bun/install/global/node_modules/@hyperpuncher/pi-ui/dist/npm/server-main.js",
	]);
	assertFalse(config.transient);
});

test("autostart rejects a transient bunx package", async () => {
	await assertRejects(
		() =>
			enableServerAutostart({
				platform: "linux",
				executable: "/home/test/.bun/bin/bun",
				args: [
					"/home/test/.bun/install/cache/@hyperpuncher/pi-ui@0.38.2/dist/npm/server-main.js",
				],
				home: "/home/test",
				transient: true,
			}),
		Error,
		"bun i -g @hyperpuncher/pi-ui",
	);
});

test("mac installer migrates the renamed Homebrew formula", async () => {
	const script = await Bun.file(
		new URL("../packaging/install.sh", import.meta.url),
	).text();
	assertStringIncludes(script, "brew migrate pi-ui");
});

test("windows installer waits only for the service installation command", async () => {
	const script = await Bun.file(
		new URL("../packaging/windows/install.ps1", import.meta.url),
	).text();
	assertStringIncludes(script, '$archiveName = "pi-ui-windows-x64.zip"');
	assertStringIncludes(script, "$legacyInstallDirectory = Join-Path");
	assertStringIncludes(script, "$command.WaitForExit()");
	assertFalse(/Start-Process[^\r\n]+-Wait/.test(script));
});
