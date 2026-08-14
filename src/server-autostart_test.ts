import { assertEquals, assertStringIncludes } from "@std/assert";

import {
	launchAgent,
	serverAutostartConfig,
	systemdService,
	windowsRunCommand,
} from "./server-autostart.ts";

Deno.test("systemd service starts the current server executable", () => {
	const service = systemdService({
		platform: "linux",
		executable: "/home/Test User/pi-ui%dev",
		home: "/home/Test User",
	});

	assertStringIncludes(service, "ExecStart=/home/Test\\x20User/pi-ui\\x25dev");
	assertStringIncludes(service, "WantedBy=default.target");
});

Deno.test("launch agent starts at login and escapes paths", () => {
	const agent = launchAgent({
		platform: "darwin",
		executable: "/Applications/pi-ui & dev.app/Contents/MacOS/pi-ui",
		home: "/Users/test",
		uid: 501,
	});

	assertStringIncludes(agent, "<key>RunAtLoad</key>");
	assertStringIncludes(agent, "<key>KeepAlive</key>");
	assertStringIncludes(agent, "<key>SuccessfulExit</key>");
	assertStringIncludes(agent, "/Applications/pi-ui &amp; dev.app/Contents/MacOS/pi-ui");
});

Deno.test("windows startup command quotes the executable", () => {
	assertEquals(
		windowsRunCommand({
			platform: "windows",
			executable: "C:\\Program Files\\pi-ui\\pi-ui.exe",
			home: "C:\\Users\\test",
		}),
		'"C:\\Program Files\\pi-ui\\pi-ui.exe"',
	);
});

Deno.test("autostart uses the current server executable", () => {
	assertEquals(serverAutostartConfig("linux").executable, Deno.execPath());
});
