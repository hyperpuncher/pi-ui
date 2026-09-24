import { test } from "bun:test";
import { rm } from "node:fs/promises";
import { join, resolve } from "node:path";

import { assertEquals, assertExists } from "#testing/assertions";
import { makeTempDir } from "#testing/temp";

import { delegateLedgerDir, listRecentDelegations } from "./delegate-ledger-reader.ts";

test("delegateLedgerDir appends 'ledger' under the PI_HERDR_DELEGATE_DIR override", () => {
	const env = { PI_HERDR_DELEGATE_DIR: "/custom/delegate-dir" } as NodeJS.ProcessEnv;
	assertEquals(delegateLedgerDir(env), join(resolve("/custom/delegate-dir"), "ledger"));
});

test("listRecentDelegations tolerates a missing ledger directory", async () => {
	const env = { PI_HERDR_DELEGATE_DIR: "/definitely/not/on/disk" } as NodeJS.ProcessEnv;
	assertEquals(await listRecentDelegations(env), []);
});

test("listRecentDelegations parses well-formed records, drops malformed ones, sorts newest first", async () => {
	const delegateDir = await makeTempDir({ prefix: "pi-ui-delegate-test-" });
	const env = { PI_HERDR_DELEGATE_DIR: delegateDir } as NodeJS.ProcessEnv;
	const dir = delegateLedgerDir(env);
	await Bun.write(
		join(dir, "dlg-aaaaaaaaaaaa.json"),
		JSON.stringify({
			delegationId: "dlg-aaaaaaaaaaaa",
			prompt: "do a thing",
			status: "done",
			delegatedAt: 100,
			childName: "scout",
		}),
	);
	await Bun.write(
		join(dir, "dlg-bbbbbbbbbbbb.json"),
		JSON.stringify({
			delegationId: "dlg-bbbbbbbbbbbb",
			prompt: "do another thing",
			status: "running",
			delegatedAt: 200,
		}),
	);
	// Neither a valid delegation id nor a parseable record — both must be silently dropped.
	await Bun.write(join(dir, "not-a-delegation.json"), JSON.stringify({ foo: "bar" }));
	await Bun.write(join(dir, "dlg-cccccccccccc.json"), "{not valid json");
	try {
		const entries = await listRecentDelegations(env);
		assertEquals(entries.length, 2);
		assertEquals(entries[0]?.delegationId, "dlg-bbbbbbbbbbbb");
		assertEquals(entries[1]?.delegationId, "dlg-aaaaaaaaaaaa");
		assertEquals(entries[1]?.childName, "scout");
	} finally {
		await rm(delegateDir, { recursive: true });
	}
});

test("listRecentDelegations truncates long free-text fields", async () => {
	const delegateDir = await makeTempDir({ prefix: "pi-ui-delegate-test-" });
	const env = { PI_HERDR_DELEGATE_DIR: delegateDir } as NodeJS.ProcessEnv;
	const dir = delegateLedgerDir(env);
	await Bun.write(
		join(dir, "dlg-dddddddddddd.json"),
		JSON.stringify({
			delegationId: "dlg-dddddddddddd",
			prompt: "x".repeat(1000),
			status: "done",
			delegatedAt: 1,
		}),
	);
	try {
		const [entry] = await listRecentDelegations(env);
		assertExists(entry);
		if (entry.prompt.length > 301) {
			throw new Error(
				`expected the prompt to be truncated, got ${entry.prompt.length} chars`,
			);
		}
	} finally {
		await rm(delegateDir, { recursive: true });
	}
});
