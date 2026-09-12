import { test } from "bun:test";

import { assertEquals } from "#testing/assertions";

import { checkForUpdate, compareVersions, upgradeCommand } from "./update-check.ts";

test("versions compare numerically and treat releases above prereleases", () => {
	assertEquals(compareVersions("0.45.0", "0.44.0"), 1);
	assertEquals(compareVersions("0.44.0", "0.45.0"), -1);
	assertEquals(compareVersions("0.44.0", "0.44.0"), 0);
	assertEquals(compareVersions("0.45.0", "0.45.0-beta.1"), 1);
	assertEquals(compareVersions("0.45.0-beta.1", "0.45.0"), -1);
	assertEquals(compareVersions("0.10.0", "0.9.0"), 1);
	assertEquals(compareVersions("not a version", "0.44.0"), 0);
});

test("update checks report only newer published versions", async () => {
	const newer = await checkForUpdate(
		async () => Response.json({ version: "0.45.0" }),
		"0.44.0",
	);
	assertEquals(newer?.latestVersion, "0.45.0");
	assertEquals(newer?.currentVersion, "0.44.0");
	assertEquals(
		newer?.releaseUrl,
		"https://github.com/hyperpuncher/pi-ui/releases/tag/v0.45.0",
	);

	const current = await checkForUpdate(
		async () => Response.json({ version: "0.44.0" }),
		"0.44.0",
	);
	assertEquals(current, undefined);
});

test("update checks ignore failed responses and malformed payloads", async () => {
	const failing = await checkForUpdate(
		async () => new Response("nope", { status: 503 }),
		"0.44.0",
	);
	assertEquals(failing, undefined);

	const malformed = await checkForUpdate(
		async () => Response.json({ version: 45 }),
		"0.44.0",
	);
	assertEquals(malformed, undefined);

	const offline = await checkForUpdate(async () => {
		throw new Error("offline");
	}, "0.44.0");
	assertEquals(offline, undefined);
});

test("upgrade commands follow the installation channel", () => {
	assertEquals(
		upgradeCommand("win32", "C:\\Program Files\\pi-ui\\pi-ui.exe"),
		"irm https://pi-ui.app/install.ps1 | iex",
	);
	assertEquals(
		upgradeCommand("darwin", "/opt/homebrew/Cellar/pi-ui/0.44.0/bin/pi-ui"),
		"brew upgrade hyperpuncher/tap/pi-ui",
	);
	assertEquals(
		upgradeCommand("linux", "/usr/bin/pi-ui", "", true),
		"paru -S pi-ui-bin",
	);
	assertEquals(
		upgradeCommand(
			"linux",
			"/usr/bin/node",
			"/usr/lib/node_modules/pi-ui/dist/npm/server-main.js",
			false,
		),
		"bun i -g @hyperpuncher/pi-ui",
	);
	assertEquals(
		upgradeCommand("linux", "/home/user/.local/bin/pi-ui", "", false),
		"curl -fsSL https://pi-ui.app/install | sh",
	);
});
