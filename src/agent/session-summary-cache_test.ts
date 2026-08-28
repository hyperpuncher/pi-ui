import { test } from "bun:test";
import { join } from "node:path";

import { assertEquals, assertFalse } from "#testing/assertions";
import { mkdir, remove, stat, writeTextFile } from "#testing/files";
import { makeTempDir } from "#testing/temp";

import { listCachedSessions } from "./session-catalog.ts";
import { readSessionSummaryCache } from "./session-summary-cache.ts";

test("sessions reuse and incrementally update the summary cache", async () => {
	const root = await makeTempDir();
	const sessionsRoot = join(root, "sessions");
	const workspace = join(sessionsRoot, "workspace");
	const sessionPath = join(workspace, "session.jsonl");
	const cachePath = join(root, "cache", "session-index.json");
	await mkdir(workspace, { recursive: true });
	try {
		await writeTextFile(
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
		assertEquals(firstEntry.indexedBytes, (await stat(sessionPath)).size);
		assertFalse("size" in firstEntry);

		await writeTextFile(
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
			(await stat(sessionPath)).size,
		);
	} finally {
		await remove(root, { recursive: true });
	}
});

test("the cached catalog indexes every session and drops deleted files", async () => {
	const root = await makeTempDir();
	const sessionsRoot = join(root, "sessions");
	const workspace = join(sessionsRoot, "workspace");
	const cachePath = join(root, "cache", "session-index.json");
	await mkdir(workspace, { recursive: true });
	try {
		for (const index of [1, 2]) {
			await writeTextFile(
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

		await remove(join(workspace, "session-1.jsonl"));
		assertEquals((await listCachedSessions(sessionsRoot, cachePath)).length, 1);
		assertEquals(Object.keys((await readSessionSummaryCache(cachePath)).sessions), [
			join(workspace, "session-2.jsonl"),
		]);
	} finally {
		await remove(root, { recursive: true });
	}
});

test("attachment references produce readable session titles", async () => {
	const root = await makeTempDir();
	const sessionsRoot = join(root, "sessions");
	const workspace = join(sessionsRoot, "workspace");
	const cachePath = join(root, "cache", "session-index.json");
	await mkdir(workspace, { recursive: true });
	try {
		const prompts = [
			"@/tmp/pi-ui-transfers/file-d1a3d330684a04ab-image.png",
			"@/tmp/pi-ui-transfers/file-a1-image.png\n@/tmp/pi-ui-transfers/file-b2-notes.md",
			"@/tmp/pi-ui-transfers/file-a1-image.png\nwhy is the sidebar visible?",
		];
		for (const [index, prompt] of prompts.entries()) {
			await writeTextFile(
				join(workspace, `session-${index}.jsonl`),
				lines([
					{
						type: "session",
						version: 3,
						id: `session-${index}`,
						timestamp: `2026-01-0${index + 1}T00:00:00.000Z`,
						cwd: "/workspace",
					},
					message("user", prompt, (index + 1) * 1_000),
				]),
			);
		}

		const sessions = await listCachedSessions(sessionsRoot, cachePath);
		const titles = Object.fromEntries(
			sessions.map((session) => [session.id, session.firstMessage]),
		);
		assertEquals(titles, {
			"session-0": "image.png",
			"session-1": "2 attachments",
			"session-2": "why is the sidebar visible?",
		});
	} finally {
		await remove(root, { recursive: true });
	}
});

test("a corrupt summary cache is rebuilt", async () => {
	const root = await makeTempDir();
	const sessionsRoot = join(root, "sessions");
	const workspace = join(sessionsRoot, "workspace");
	const sessionPath = join(workspace, "session.jsonl");
	const cachePath = join(root, "cache", "session-index.json");
	await mkdir(workspace, { recursive: true });
	await mkdir(join(root, "cache"), { recursive: true });
	try {
		await writeTextFile(cachePath, "not json");
		await writeTextFile(
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
		assertEquals((await readSessionSummaryCache(cachePath)).version, 2);
	} finally {
		await remove(root, { recursive: true });
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
