import { test } from "bun:test";

import { assertEquals, assertFalse, assertStringIncludes } from "#testing/assertions";

import {
	launchAgent,
	serverAutostartConfig,
	systemdService,
	windowsRunCommand,
} from "./server-autostart.ts";

test("systemd service starts the current server executable", () => {
	const service = systemdService({
		platform: "linux",
		executable: "/home/Test User/pi-ui%dev",
		home: "/home/Test User",
	});

	assertStringIncludes(service, "ExecStart=/home/Test\\x20User/pi-ui\\x25dev");
	assertStringIncludes(service, "WantedBy=default.target");
});

test("launch agent starts at login and escapes paths", () => {
	const agent = launchAgent({
		platform: "darwin",
		executable: "/Applications/pi-ui & dev.app/Contents/MacOS/pi-ui",
		home: "/Users/test",
		uid: 501,
	});

	assertStringIncludes(agent, "<string>dev.pi.ui</string>");
	assertStringIncludes(agent, "<key>RunAtLoad</key>");
	assertStringIncludes(agent, "/Library/Logs/pi-ui.log");
	assertStringIncludes(agent, "<key>KeepAlive</key>");
	assertStringIncludes(agent, "<key>SuccessfulExit</key>");
	assertStringIncludes(agent, "/Applications/pi-ui &amp; dev.app/Contents/MacOS/pi-ui");
});

test("windows startup command quotes the executable", () => {
	assertEquals(
		windowsRunCommand({
			platform: "windows",
			executable: "C:\\Program Files\\pi-ui\\pi-ui.exe",
			home: "C:\\Users\\test",
		}),
		'"C:\\Program Files\\pi-ui\\pi-ui.exe"',
	);
});

test("autostart uses the current server executable", () => {
	assertEquals(serverAutostartConfig("linux").executable, process.execPath);
});

test("windows installer waits only for the autostart command", async () => {
	const script = await Bun.file(
		new URL("../packaging/windows/install.ps1", import.meta.url),
	).text();
	assertStringIncludes(script, '$archiveName = "pi-ui-windows-x64.zip"');
	assertStringIncludes(script, "$legacyInstallDirectory = Join-Path");
	assertStringIncludes(script, "$command.WaitForExit()");
	assertFalse(/Start-Process[^\r\n]+-Wait/.test(script));
});
