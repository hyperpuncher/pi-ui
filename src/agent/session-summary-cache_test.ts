import { assertEquals, assertFalse } from "@std/assert";
import { join } from "@std/path";

import { listCachedSessions } from "./session-catalog.ts";
import { readSessionSummaryCache } from "./session-summary-cache.ts";

Deno.test("sessions reuse and incrementally update the summary cache", async () => {
	const root = await Deno.makeTempDir();
	const sessionsRoot = join(root, "sessions");
	const workspace = join(sessionsRoot, "workspace");
	const sessionPath = join(workspace, "session.jsonl");
	const cachePath = join(root, "cache", "session-index.json");
	await Deno.mkdir(workspace, { recursive: true });
	try {
		await Deno.writeTextFile(
			sessionPath,
			lines([
				{
					type: "session",
					version: 3,
					id: "session-1",
					timestamp: "2026-01-01T00:00:00.000Z",
					cwd: "/workspace",
				},
				message("user", "First prompt", 1_000),
				message("assistant", "First answer", 2_000),
				{
					type: "session_info",
					name: "Cached title",
					timestamp: "2026-01-01T00:00:03.000Z",
				},
			]),
		);

		const initial = await listCachedSessions(sessionsRoot, cachePath);
		assertEquals(initial.length, 1);
		assertEquals(initial[0].name, "Cached title");
		assertEquals(initial[0].messageCount, 2);

		const firstCache = await readSessionSummaryCache(cachePath);
		const firstEntry = firstCache.sessions[sessionPath];
		assertEquals(firstEntry.indexedBytes, (await Deno.stat(sessionPath)).size);
		assertFalse("size" in firstEntry);

		await Deno.writeTextFile(
			sessionPath,
			lines([message("user", "Appended prompt", 4_000)]),
			{ append: true },
		);
		const updated = await listCachedSessions(sessionsRoot, cachePath);
		assertEquals(updated[0].messageCount, 3);
		assertEquals(updated[0].firstMessage, "First prompt");
		assertEquals(updated[0].modified, new Date(4_000));

		const secondCache = await readSessionSummaryCache(cachePath);
		assertEquals(
			secondCache.sessions[sessionPath].indexedBytes,
			(await Deno.stat(sessionPath)).size,
		);
	} finally {
		await Deno.remove(root, { recursive: true });
	}
});

Deno.test("the cached catalog indexes every session and drops deleted files", async () => {
	const root = await Deno.makeTempDir();
	const sessionsRoot = join(root, "sessions");
	const workspace = join(sessionsRoot, "workspace");
	const cachePath = join(root, "cache", "session-index.json");
	await Deno.mkdir(workspace, { recursive: true });
	try {
		for (const index of [1, 2]) {
			await Deno.writeTextFile(
				join(workspace, `session-${index}.jsonl`),
				lines([
					{
						type: "session",
						version: 3,
						id: `session-${index}`,
						timestamp: `2026-01-0${index}T00:00:00.000Z`,
						cwd: "/workspace",
					},
					message("user", `Session ${index}`, index * 1_000),
				]),
			);
		}

		assertEquals((await listCachedSessions(sessionsRoot, cachePath)).length, 2);
		assertEquals(
			Object.keys((await readSessionSummaryCache(cachePath)).sessions).length,
			2,
		);

		await Deno.remove(join(workspace, "session-1.jsonl"));
		assertEquals((await listCachedSessions(sessionsRoot, cachePath)).length, 1);
		assertEquals(Object.keys((await readSessionSummaryCache(cachePath)).sessions), [
			join(workspace, "session-2.jsonl"),
		]);
	} finally {
		await Deno.remove(root, { recursive: true });
	}
});

Deno.test("a corrupt summary cache is rebuilt", async () => {
	const root = await Deno.makeTempDir();
	const sessionsRoot = join(root, "sessions");
	const workspace = join(sessionsRoot, "workspace");
	const sessionPath = join(workspace, "session.jsonl");
	const cachePath = join(root, "cache", "session-index.json");
	await Deno.mkdir(workspace, { recursive: true });
	await Deno.mkdir(join(root, "cache"), { recursive: true });
	try {
		await Deno.writeTextFile(cachePath, "not json");
		await Deno.writeTextFile(
			sessionPath,
			lines([
				{
					type: "session",
					version: 3,
					id: "session-1",
					timestamp: "2026-01-01T00:00:00.000Z",
					cwd: "/workspace",
				},
				message("user", "Recovered", 1_000),
			]),
		);

		const sessions = await listCachedSessions(sessionsRoot, cachePath);
		assertEquals(sessions[0].firstMessage, "Recovered");
		assertEquals((await readSessionSummaryCache(cachePath)).version, 1);
	} finally {
		await Deno.remove(root, { recursive: true });
	}
});

function message(role: "assistant" | "user", text: string, timestamp: number) {
	return {
		type: "message",
		timestamp: new Date(timestamp).toISOString(),
		message: { role, content: [{ type: "text", text }], timestamp },
	};
}

function lines(values: readonly unknown[]): string {
	return `${values.map((value) => JSON.stringify(value)).join("\n")}\n`;
}
