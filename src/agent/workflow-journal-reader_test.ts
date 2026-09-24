import { test } from "bun:test";
import { rm } from "node:fs/promises";
import { join } from "node:path";

import { assertEquals, assertExists } from "#testing/assertions";
import { makeTempDir } from "#testing/temp";

import {
	readLatestWorkflowJournal,
	workflowProjectDir,
} from "./workflow-journal-reader.ts";

/** `workflowProjectDir`/`readLatestWorkflowJournal` resolve `~/.pi/workflows/projects/...` via
 * `node:os`'s `homedir()`, which re-reads `HOME`/`USERPROFILE` on every call rather than caching
 * it at import time — so temporarily pointing it at a scratch directory is a faithful stand-in
 * for a real home directory, isolated from whatever actually runs this test suite. */
async function withFakeHome<T>(run: (home: string) => Promise<T>): Promise<T> {
	const home = await makeTempDir({ prefix: "pi-ui-workflow-home-" });
	const originalHome = process.env.HOME;
	const originalProfile = process.env.USERPROFILE;
	process.env.HOME = home;
	process.env.USERPROFILE = home;
	try {
		return await run(home);
	} finally {
		if (originalHome === undefined) delete process.env.HOME;
		else process.env.HOME = originalHome;
		if (originalProfile === undefined) delete process.env.USERPROFILE;
		else process.env.USERPROFILE = originalProfile;
		await rm(home, { recursive: true });
	}
}

test("workflowProjectDir is a deterministic function of the cwd, nested under ~/.pi/workflows/projects", async () => {
	await withFakeHome(async (home) => {
		const dir = workflowProjectDir("/workspace/My Project!");
		assertEquals(dir, workflowProjectDir("/workspace/My Project!"));
		if (!dir.startsWith(join(home, ".pi", "workflows", "projects"))) {
			throw new Error(`expected ${dir} to live under the fake home`);
		}
		if (!dir.includes("my-project-")) {
			throw new Error(`expected a slugified project name in ${dir}`);
		}
	});
});

test("readLatestWorkflowJournal returns undefined when no run journal exists for the workspace", async () => {
	await withFakeHome(async () => {
		assertEquals(await readLatestWorkflowJournal("/workspace/never-run"), undefined);
	});
});

test("readLatestWorkflowJournal summarizes the most recently modified run, defensively coercing agents", async () => {
	await withFakeHome(async () => {
		const cwd = "/workspace/my-project";
		const dir = workflowProjectDir(cwd);
		await Bun.write(
			join(dir, "run-0.json"),
			JSON.stringify({ runId: "run-0", workflowName: "Older run" }),
		);
		await new Promise((resolveDelay) => setTimeout(resolveDelay, 10));
		await Bun.write(
			join(dir, "run-1.json"),
			JSON.stringify({
				runId: "run-1",
				workflowName: "Refactor auth",
				status: "running",
				phases: ["plan", "implement", 42],
				agents: [
					{
						id: 1,
						label: "scout",
						status: "done",
						model: "gpt-5",
						usage: { total: 500 },
					},
					{ id: "not-a-number" },
				],
			}),
		);
		const summary = await readLatestWorkflowJournal(cwd);
		assertExists(summary);
		assertEquals(summary.runId, "run-1");
		assertEquals(summary.phases, ["plan", "implement"]);
		assertEquals(summary.agents.length, 1);
		assertEquals(summary.agents[0]?.label, "scout");
		assertEquals(summary.agents[0]?.tokens, 500);
	});
});

test("readLatestWorkflowJournal tolerates a malformed journal file", async () => {
	await withFakeHome(async () => {
		const cwd = "/workspace/broken-project";
		const dir = workflowProjectDir(cwd);
		await Bun.write(join(dir, "run-broken.json"), "{not valid json");
		assertEquals(await readLatestWorkflowJournal(cwd), undefined);
	});
});
