import { afterEach, test } from "bun:test";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

import { assertEquals } from "#testing/assertions";

import { resolveSessionDir, sessionDirOverride } from "./session-dir.ts";

const original = process.env.PI_CODING_AGENT_SESSION_DIR;

afterEach(() => {
	if (original === undefined) delete process.env.PI_CODING_AGENT_SESSION_DIR;
	else process.env.PI_CODING_AGENT_SESSION_DIR = original;
});

test("a session dir override wins over the agent sessions root", () => {
	// `sessionDirOverride`/`resolveSessionDir` resolve against the process's cwd
	// (drive) via `node:path`'s `resolve`, so the expected value must go through
	// the same resolution rather than a hardcoded POSIX literal — on Windows
	// `resolve("/tmp/custom-sessions")` lands under the current drive, not `/tmp`.
	process.env.PI_CODING_AGENT_SESSION_DIR = "/tmp/custom-sessions";
	const expected = resolve("/tmp/custom-sessions");
	assertEquals(sessionDirOverride(), expected);
	assertEquals(resolveSessionDir("/agent"), expected);
});

test("without an override sessions live under the agent dir", () => {
	delete process.env.PI_CODING_AGENT_SESSION_DIR;
	assertEquals(sessionDirOverride(), undefined);
	assertEquals(resolveSessionDir("/agent"), resolve("/agent", "sessions"));
});

test("the override expands a leading tilde", () => {
	process.env.PI_CODING_AGENT_SESSION_DIR = "~/demo-sessions";
	assertEquals(sessionDirOverride(), join(homedir(), "demo-sessions"));
});
