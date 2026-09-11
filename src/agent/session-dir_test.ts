import { afterEach, test } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";

import { assertEquals } from "#testing/assertions";

import { resolveSessionDir, sessionDirOverride } from "./session-dir.ts";

const original = process.env.PI_CODING_AGENT_SESSION_DIR;

afterEach(() => {
	if (original === undefined) delete process.env.PI_CODING_AGENT_SESSION_DIR;
	else process.env.PI_CODING_AGENT_SESSION_DIR = original;
});

test("a session dir override wins over the agent sessions root", () => {
	process.env.PI_CODING_AGENT_SESSION_DIR = "/tmp/custom-sessions";
	assertEquals(sessionDirOverride(), "/tmp/custom-sessions");
	assertEquals(resolveSessionDir("/agent"), "/tmp/custom-sessions");
});

test("without an override sessions live under the agent dir", () => {
	delete process.env.PI_CODING_AGENT_SESSION_DIR;
	assertEquals(sessionDirOverride(), undefined);
	assertEquals(resolveSessionDir("/agent"), join("/agent", "sessions"));
});

test("the override expands a leading tilde", () => {
	process.env.PI_CODING_AGENT_SESSION_DIR = "~/demo-sessions";
	assertEquals(sessionDirOverride(), join(homedir(), "demo-sessions"));
});
