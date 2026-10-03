import { test } from "bun:test";

import { canRevealFiles, revealFileCommand } from "#src/server/file-manager.ts";
import { assertEquals } from "#testing/assertions";

test("remote hosts, unknown clients and proxies cannot access the file manager", () => {
	for (const [url, address, headers] of [
		["http://server.example", "127.0.0.1", {}],
		["http://localhost", undefined, {}],
		["http://localhost", "127.0.0.1", { "x-forwarded-for": "192.168.1.2" }],
		["http://localhost", "::1", { forwarded: "for=192.168.1.2" }],
	] as const) {
		assertEquals(canRevealFiles(new Request(url, { headers }), address), false);
	}
});

test("file reveal commands preserve paths with spaces and special characters", () => {
	const path = "/tmp/a file's #name.txt";
	assertEquals(revealFileCommand(path, "darwin"), ["open", "-R", path]);
	assertEquals(revealFileCommand("C:\\my files\\a.txt", "windows"), [
		"explorer.exe",
		"/select,C:\\my files\\a.txt",
	]);
	assertEquals(revealFileCommand(path, "linux").slice(-3), [
		"org.freedesktop.FileManager1.ShowItems",
		`["file:///tmp/a%20file's%20%23name.txt"]`,
		"",
	]);
});
