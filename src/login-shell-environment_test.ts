import { test } from "bun:test";

import { assertEquals } from "#testing/assertions";

import { importLoginShellEnvironment } from "./login-shell-environment.ts";

test("background servers import their login shell environment", async () => {
	const environment: NodeJS.ProcessEnv = {
		PATH: "/usr/bin",
		SHELL: "/bin/zsh",
	};
	let receivedShell: string | undefined;

	await importLoginShellEnvironment({
		environment,
		isTerminal: false,
		platform: "linux",
		readOutput: async (shell) => {
			receivedShell = shell;
			return [
				"shell startup noise\0",
				"PATH=/home/test/.local/bin:/usr/bin\0",
				"TEST_TOKEN=available\0",
				"MULTILINE=first line\nsecond line\0",
				"EQUALS=one=two\0",
				"\0shell exit noise",
			].join("");
		},
	});

	assertEquals(receivedShell, "/bin/zsh");
	assertEquals(environment.PATH, "/home/test/.local/bin:/usr/bin");
	assertEquals(environment.TEST_TOKEN, "available");
	assertEquals(environment.MULTILINE, "first line\nsecond line");
	assertEquals(environment.EQUALS, "one=two");
});

test("terminal servers keep the environment they inherited", async () => {
	const environment: NodeJS.ProcessEnv = {
		PATH: "/terminal/bin:/usr/bin",
		SHELL: "/bin/zsh",
	};
	let reads = 0;

	await importLoginShellEnvironment({
		environment,
		isTerminal: true,
		platform: "linux",
		readOutput: async () => {
			reads++;
			return "\0PATH=/login/bin:/usr/bin\0\0";
		},
	});

	assertEquals(reads, 0);
	assertEquals(environment.PATH, "/terminal/bin:/usr/bin");
});

test("windows keeps its inherited user environment", async () => {
	const environment: NodeJS.ProcessEnv = {
		PATH: "C:\\Windows\\System32",
	};
	let reads = 0;

	await importLoginShellEnvironment({
		environment,
		isTerminal: false,
		platform: "win32",
		readOutput: async () => {
			reads++;
			return "\0PATH=C:\\Users\\test\\bin\0\0";
		},
	});

	assertEquals(reads, 0);
	assertEquals(environment.PATH, "C:\\Windows\\System32");
});
