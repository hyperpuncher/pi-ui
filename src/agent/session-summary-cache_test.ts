import { test } from "bun:test";
import { appendFile, mkdir, rm, stat } from "node:fs/promises";
import { join } from "node:path";

import { assertEquals, assertFalse } from "#testing/assertions";
import { symlinkDir } from "#testing/symlink";
import { makeTempDir } from "#testing/temp";

import { operatingSystem } from "../utils/platform.ts";
import { listCachedSessions } from "./session-catalog.ts";
import { openableSessionPath, readSessionSummaryCache } from "./session-summary-cache.ts";

test("sessions reuse and incrementally update the summary cache", async () => {
	const { root, sessionsRoot, workspace, cachePath } = await makeSessionDirs();
	const sessionPath = join(workspace, "session.jsonl");
	await mkdir(workspace, { recursive: true });
	try {
		await Bun.write(
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

		await appendFile(sessionPath, lines([message("user", "Appended prompt", 4_000)]));
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
		await rm(root, { recursive: true });
	}
});

test("the cached catalog indexes every session and drops deleted files", async () => {
	const { root, sessionsRoot, workspace, cachePath } = await makeSessionDirs();
	await mkdir(workspace, { recursive: true });
	try {
		for (const index of [1, 2]) {
			await Bun.write(
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

		await rm(join(workspace, "session-1.jsonl"));
		assertEquals((await listCachedSessions(sessionsRoot, cachePath)).length, 1);
		assertEquals(Object.keys((await readSessionSummaryCache(cachePath)).sessions), [
			join(workspace, "session-2.jsonl"),
		]);
	} finally {
		await rm(root, { recursive: true });
	}
});

test("flat custom session dirs and symlinked workspaces are discovered", async () => {
	const { root, sessionsRoot, cachePath } = await makeSessionDirs();
	await mkdir(sessionsRoot, { recursive: true });
	try {
		// A custom session dir stores files directly in the root.
		await Bun.write(
			join(sessionsRoot, "flat.jsonl"),
			lines([
				{
					type: "session",
					version: 3,
					id: "flat",
					timestamp: "2026-01-01T00:00:00.000Z",
					cwd: "/flat",
				},
				message("user", "Flat session", 1_000),
			]),
		);

		// The default layout uses workspace subdirectories, which may be symlinks.
		const linkedWorkspace = join(root, "linked-workspace");
		await mkdir(linkedWorkspace, { recursive: true });
		await Bun.write(
			join(linkedWorkspace, "linked.jsonl"),
			lines([
				{
					type: "session",
					version: 3,
					id: "linked",
					timestamp: "2026-01-02T00:00:00.000Z",
					cwd: "/linked",
				},
				message("user", "Linked session", 2_000),
			]),
		);
		await symlinkDir(linkedWorkspace, join(sessionsRoot, "workspace"));

		const sessions = await listCachedSessions(sessionsRoot, cachePath);
		assertEquals(
			sessions.map((session) => session.id),
			["linked", "flat"],
		);
		assertEquals(
			Object.fromEntries(sessions.map((session) => [session.id, session.cwd])),
			{ flat: "/flat", linked: "/linked" },
		);
	} finally {
		await rm(root, { recursive: true });
	}
});

test("attachment references produce readable session titles", async () => {
	const { root, sessionsRoot, workspace, cachePath } = await makeSessionDirs();
	await mkdir(workspace, { recursive: true });
	try {
		const prompts = [
			"@/tmp/pi-ui-transfers/file-d1a3d330684a04ab-image.png",
			"@/tmp/pi-ui-transfers/file-a1-image.png\n@/tmp/pi-ui-transfers/file-b2-notes.md",
			"@/tmp/pi-ui-transfers/file-a1-image.png\nwhy is the sidebar visible?",
		];
		for (const [index, prompt] of prompts.entries()) {
			await Bun.write(
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
		await rm(root, { recursive: true });
	}
});

test("a corrupt summary cache is rebuilt", async () => {
	const { root, sessionsRoot, workspace, cachePath } = await makeSessionDirs();
	const sessionPath = join(workspace, "session.jsonl");
	await mkdir(workspace, { recursive: true });
	await mkdir(join(root, "cache"), { recursive: true });
	try {
		await Bun.write(cachePath, "not json");
		await Bun.write(
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
		await rm(root, { recursive: true });
	}
});

// round-4 (r3-merge.md): a session file whose full path is at or beyond Windows' MAX_PATH
// (260 chars) silently dropped out of the sidebar, because Bun's file APIs treat such a path
// as missing rather than opening it. `openableSessionPath` is the fix — see its own docs.
test.skipIf(operatingSystem !== "windows")(
	"openableSessionPath adds the \\\\?\\ extended-length prefix past MAX_PATH on Windows",
	() => {
		const short = "C:\\Users\\me\\sessions\\a.jsonl";
		assertEquals(openableSessionPath(short), short);

		const long = `C:\\Users\\me\\${"deeply-nested-".repeat(20)}\\a.jsonl`;
		assertEquals(long.length >= 260, true);
		assertEquals(openableSessionPath(long), `\\\\?\\${long}`);

		// Forward slashes are never normalized under the `\\?\` prefix, so they must be
		// converted before it's applied.
		const longForwardSlashes = long.replaceAll("\\", "/");
		assertEquals(openableSessionPath(longForwardSlashes), `\\\\?\\${long}`);

		// A UNC path needs `UNC` spliced in after the prefix instead of its leading `\\`.
		const longUnc = `\\\\server\\share\\${"deeply-nested-".repeat(20)}\\a.jsonl`;
		assertEquals(
			openableSessionPath(longUnc),
			`\\\\?\\UNC\\server\\share\\${"deeply-nested-".repeat(20)}\\a.jsonl`,
		);

		// Already prefixed — passed through unchanged, not double-prefixed.
		const alreadyPrefixed = `\\\\?\\${long}`;
		assertEquals(openableSessionPath(alreadyPrefixed), alreadyPrefixed);
	},
);

async function makeSessionDirs() {
	const root = await makeTempDir();
	const sessionsRoot = join(root, "sessions");
	const workspace = join(sessionsRoot, "workspace");
	const cachePath = join(root, "cache", "session-index.json");
	return { root, sessionsRoot, workspace, cachePath };
}

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
