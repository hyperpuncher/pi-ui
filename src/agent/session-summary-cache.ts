import type { SessionInfo } from "@earendil-works/pi-coding-agent";
import { dirname } from "@std/path";

import { appCachePath } from "../utils/app-cache.ts";
import { isRecord } from "../utils/type-guards.ts";

const cacheVersion = 1;
const maxSummaryTextLength = 96;
const readBufferSize = 64 * 1024;
const decoder = new TextDecoder();
const cacheWrites = new Map<string, Promise<void>>();

export type SessionSummaryCacheEntry = {
	indexedBytes: number;
	mtime: number;
	id: string;
	cwd: string;
	name?: string;
	firstMessage: string;
	messageCount: number;
	lastActivity: number;
	created: number;
	parentSessionPath?: string;
};

export type SessionSummaryCache = {
	version: 1;
	sessions: Record<string, SessionSummaryCacheEntry>;
};

export type SessionSummaryCandidate = {
	path: string;
	indexedBytes: number;
	mtime: number;
};

export function sessionSummaryCachePath(): string {
	return appCachePath("session-index.json");
}

export async function readSessionSummaryCache(
	path = sessionSummaryCachePath(),
): Promise<SessionSummaryCache> {
	try {
		const value: unknown = JSON.parse(await Deno.readTextFile(path));
		if (
			!isRecord(value) ||
			value.version !== cacheVersion ||
			!isRecord(value.sessions)
		) {
			return emptyCache();
		}
		const sessions: Record<string, SessionSummaryCacheEntry> = {};
		for (const [sessionPath, entry] of Object.entries(value.sessions)) {
			const parsed = parseCacheEntry(entry);
			if (parsed) sessions[sessionPath] = parsed;
		}
		return { version: cacheVersion, sessions };
	} catch (error) {
		if (error instanceof Deno.errors.NotFound || error instanceof SyntaxError) {
			return emptyCache();
		}
		throw error;
	}
}

export async function writeSessionSummaryCache(
	cache: SessionSummaryCache,
	path = sessionSummaryCachePath(),
): Promise<void> {
	await Deno.mkdir(dirname(path), { recursive: true });
	const temporaryPath = `${path}.${crypto.randomUUID()}.tmp`;
	try {
		await Deno.writeTextFile(temporaryPath, `${JSON.stringify(cache, null, "\t")}\n`);
		await Deno.rename(temporaryPath, path);
	} catch (error) {
		await Deno.remove(temporaryPath).catch(() => undefined);
		throw error;
	}
}

export async function updateSessionSummaryCache(
	entries: Readonly<Record<string, SessionSummaryCacheEntry>>,
	path = sessionSummaryCachePath(),
	retainedPaths?: ReadonlySet<string>,
): Promise<void> {
	const previous = cacheWrites.get(path) ?? Promise.resolve();
	const update = previous
		.catch(() => undefined)
		.then(async () => {
			const cache = await readSessionSummaryCache(path);
			Object.assign(cache.sessions, entries);
			if (retainedPaths) {
				for (const sessionPath of Object.keys(cache.sessions)) {
					if (!retainedPaths.has(sessionPath))
						delete cache.sessions[sessionPath];
				}
			}
			await writeSessionSummaryCache(cache, path);
		});
	cacheWrites.set(path, update);
	try {
		await update;
	} finally {
		if (cacheWrites.get(path) === update) cacheWrites.delete(path);
	}
}

export async function loadSessionSummary(
	candidate: SessionSummaryCandidate,
	cached?: SessionSummaryCacheEntry,
): Promise<SessionSummaryCacheEntry | undefined> {
	if (
		cached &&
		candidate.indexedBytes === cached.indexedBytes &&
		candidate.mtime === cached.mtime
	) {
		return cached;
	}
	if (cached && candidate.indexedBytes > cached.indexedBytes) {
		return await parseSessionFile(candidate, cached);
	}
	return await parseSessionFile(candidate);
}

export function sessionInfoFromSummary(
	path: string,
	entry: SessionSummaryCacheEntry,
): SessionInfo {
	return {
		path,
		id: entry.id,
		cwd: entry.cwd,
		name: entry.name,
		parentSessionPath: entry.parentSessionPath,
		created: new Date(entry.created),
		modified: new Date(entry.lastActivity || entry.mtime || entry.created),
		messageCount: entry.messageCount,
		firstMessage: entry.firstMessage || "(no messages)",
		allMessagesText: "",
	};
}

function emptyCache(): SessionSummaryCache {
	return { version: cacheVersion, sessions: {} };
}

async function parseSessionFile(
	candidate: SessionSummaryCandidate,
	cached?: SessionSummaryCacheEntry,
): Promise<SessionSummaryCacheEntry | undefined> {
	const state: MutableSummary = cached
		? { ...cached }
		: {
				indexedBytes: 0,
				mtime: candidate.mtime,
				id: "",
				cwd: "",
				firstMessage: "",
				messageCount: 0,
				lastActivity: 0,
				created: 0,
			};
	const start = cached?.indexedBytes ?? 0;
	let file: Deno.FsFile | undefined;
	try {
		file = await Deno.open(candidate.path, { read: true });
		if (start > 0) await file.seek(start, Deno.SeekMode.Start);
		const pending: Uint8Array[] = [];
		let pendingBytes = 0;
		let consumedBytes = 0;
		const buffer = new Uint8Array(readBufferSize);
		while (true) {
			const count = await file.read(buffer);
			if (count === null) break;
			const chunk = buffer.slice(0, count);
			let lineStart = 0;
			for (let index = 0; index < chunk.length; index += 1) {
				if (chunk[index] !== 10) continue;
				const part = chunk.slice(lineStart, index);
				const line = joinBytes(pending, pendingBytes, part);
				pending.length = 0;
				pendingBytes = 0;
				applyLine(state, line);
				consumedBytes += line.length + 1;
				lineStart = index + 1;
			}
			if (lineStart < chunk.length) {
				const remainder = chunk.slice(lineStart);
				pending.push(remainder);
				pendingBytes += remainder.length;
			}
		}
		if (!cached && !state.id) return undefined;
		state.indexedBytes = start + consumedBytes;
		state.mtime = candidate.mtime;
		return state;
	} catch {
		return undefined;
	} finally {
		file?.close();
	}
}

type MutableSummary = SessionSummaryCacheEntry;

function applyLine(state: MutableSummary, bytes: Uint8Array): void {
	if (bytes.length === 0) return;
	let value: unknown;
	try {
		value = JSON.parse(decoder.decode(bytes));
	} catch {
		return;
	}
	if (!isRecord(value) || typeof value.type !== "string") return;
	if (value.type === "session" && !state.id) {
		if (typeof value.id !== "string" || typeof value.timestamp !== "string") return;
		state.id = value.id;
		state.cwd = typeof value.cwd === "string" ? value.cwd : "";
		state.created = dateValue(value.timestamp);
		state.parentSessionPath =
			typeof value.parentSession === "string" ? value.parentSession : undefined;
		return;
	}
	if (value.type === "session_info") {
		state.name =
			typeof value.name === "string" && value.name.trim()
				? summaryText(value.name.trim())
				: undefined;
		return;
	}
	if (value.type !== "message") return;
	state.messageCount += 1;
	if (!isRecord(value.message)) return;
	const role = value.message.role;
	if (role !== "user" && role !== "assistant") return;
	const activity =
		typeof value.message.timestamp === "number"
			? value.message.timestamp
			: dateValue(value.timestamp);
	if (activity > 0) state.lastActivity = Math.max(state.lastActivity, activity);
	if (!state.firstMessage && role === "user") {
		state.firstMessage = summaryText(messageText(value.message.content));
	}
}

function messageText(content: unknown): string {
	if (typeof content === "string") return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const block of content) {
		if (isRecord(block) && block.type === "text" && typeof block.text === "string") {
			parts.push(block.text);
		}
	}
	return parts.join(" ");
}

function summaryText(value: string): string {
	return value.length > maxSummaryTextLength
		? `${value.slice(0, maxSummaryTextLength - 1)}…`
		: value;
}

function dateValue(value: unknown): number {
	if (typeof value !== "string") return 0;
	const parsed = new Date(value).getTime();
	return Number.isNaN(parsed) ? 0 : parsed;
}

function joinBytes(
	pending: readonly Uint8Array[],
	pendingBytes: number,
	part: Uint8Array,
): Uint8Array {
	if (pendingBytes === 0) return part;
	const result = new Uint8Array(pendingBytes + part.length);
	let offset = 0;
	for (const chunk of pending) {
		result.set(chunk, offset);
		offset += chunk.length;
	}
	result.set(part, offset);
	return result;
}

function parseCacheEntry(value: unknown): SessionSummaryCacheEntry | undefined {
	if (!isRecord(value)) return undefined;
	for (const key of [
		"indexedBytes",
		"mtime",
		"messageCount",
		"lastActivity",
		"created",
	] as const) {
		if (typeof value[key] !== "number" || !Number.isFinite(value[key]))
			return undefined;
	}
	if (
		typeof value.id !== "string" ||
		typeof value.cwd !== "string" ||
		typeof value.firstMessage !== "string"
	) {
		return undefined;
	}
	return {
		indexedBytes: value.indexedBytes as number,
		mtime: value.mtime as number,
		id: value.id,
		cwd: value.cwd,
		name: typeof value.name === "string" ? value.name : undefined,
		firstMessage: value.firstMessage,
		messageCount: value.messageCount as number,
		lastActivity: value.lastActivity as number,
		created: value.created as number,
		parentSessionPath:
			typeof value.parentSessionPath === "string"
				? value.parentSessionPath
				: undefined,
	};
}
