import { mkdir, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";

import type { SessionInfo } from "@earendil-works/pi-coding-agent";
import Type, { type Static } from "typebox";
import { Compile } from "typebox/compile";

import { appCachePath } from "#src/utils/app-dirs.ts";
import {
	attachmentDisplayName,
	splitLeadingAttachmentReferences,
} from "#src/utils/attachment-references.ts";
import { isNotFound } from "#src/utils/fs-errors.ts";
import { isNumber, isRecord, isString, type JsonRecord } from "#src/utils/type-guards.ts";

const cacheVersion = 2;
const maxSummaryTextLength = 96;
const cacheWrites = new Map<string, Promise<void>>();
const cacheEntrySchema = Type.Object({
	indexedBytes: Type.Number(),
	mtime: Type.Number(),
	id: Type.String(),
	cwd: Type.String(),
	name: Type.Optional(Type.String()),
	firstMessage: Type.String(),
	messageCount: Type.Number(),
	lastActivity: Type.Number(),
	created: Type.Number(),
	parentSessionPath: Type.Optional(Type.String()),
});
const cacheEntryValidator = Compile(cacheEntrySchema);

export type SessionSummaryCacheEntry = Static<typeof cacheEntrySchema>;

export type SessionSummaryCache = {
	version: 2;
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
		const value: unknown = await Bun.file(path).json();
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
		if (isNotFound(error) || error instanceof SyntaxError) {
			return emptyCache();
		}
		throw error;
	}
}

async function writeSessionSummaryCache(
	cache: SessionSummaryCache,
	path = sessionSummaryCachePath(),
): Promise<void> {
	await mkdir(dirname(path), { recursive: true });
	const temporaryPath = `${path}.${crypto.randomUUID()}.tmp`;
	try {
		await Bun.write(temporaryPath, `${JSON.stringify(cache, null, "\t")}\n`);
		await rename(temporaryPath, path);
	} catch (error) {
		await rm(temporaryPath).catch(() => undefined);
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
	const state: SessionSummaryCacheEntry = cached
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
	try {
		const reader = Bun.file(candidate.path).slice(start).stream().getReader();
		let pending: Uint8Array = Buffer.alloc(0);
		let consumedBytes = 0;
		while (true) {
			const { done, value: chunk } = await reader.read();
			if (done) break;
			const buffer: Uint8Array =
				pending.length === 0 ? chunk : Buffer.concat([pending, chunk]);
			const newline = buffer.lastIndexOf(10);
			if (newline < 0) {
				pending = buffer;
				continue;
			}
			const complete = buffer.subarray(0, newline + 1);
			applyCompleteLines(state, complete);
			consumedBytes += complete.length;
			pending = buffer.subarray(newline + 1);
		}
		if (!cached && !state.id) return undefined;
		state.indexedBytes = start + consumedBytes;
		state.mtime = candidate.mtime;
		return state;
	} catch {
		return undefined;
	}
}

function applyCompleteLines(state: SessionSummaryCacheEntry, bytes: Uint8Array): void {
	const result = Bun.JSONL.parseChunk(bytes);
	if (!result.error && result.done) {
		for (const value of result.values) {
			if (isRecord(value)) applyRecord(state, value);
		}
		return;
	}
	for (let lineStart = 0, newline = bytes.indexOf(10); newline >= 0;) {
		const value = parseLine(bytes.subarray(lineStart, newline));
		if (value) applyRecord(state, value);
		lineStart = newline + 1;
		newline = bytes.indexOf(10, lineStart);
	}
}

function applyRecord(state: SessionSummaryCacheEntry, value: JsonRecord): void {
	if (!isString(value.type)) return;
	if (value.type === "session") {
		if (!state.id) applySession(state, value);
	} else if (value.type === "session_info") {
		applySessionInfo(state, value);
	} else if (value.type === "message") {
		applyMessage(state, value);
	}
}

function parseLine(bytes: Uint8Array): JsonRecord | undefined {
	if (bytes.length === 0) return undefined;
	const result = Bun.JSONL.parseChunk(bytes);
	if (result.error || !result.done || result.values.length !== 1) return undefined;
	const value = result.values[0];
	return isRecord(value) ? value : undefined;
}

function applySession(state: SessionSummaryCacheEntry, value: JsonRecord): void {
	if (!isString(value.id) || !isString(value.timestamp)) return;
	state.id = value.id;
	state.cwd = isString(value.cwd) ? value.cwd : "";
	state.created = dateValue(value.timestamp);
	state.parentSessionPath = isString(value.parentSession)
		? value.parentSession
		: undefined;
}

function applySessionInfo(state: SessionSummaryCacheEntry, value: JsonRecord): void {
	state.name =
		isString(value.name) && value.name.trim()
			? summaryText(value.name.trim())
			: undefined;
}

function applyMessage(state: SessionSummaryCacheEntry, value: JsonRecord): void {
	state.messageCount += 1;
	if (!isRecord(value.message)) return;
	const role = value.message.role;
	if (role !== "user" && role !== "assistant") return;
	const activity = isNumber(value.message.timestamp)
		? value.message.timestamp
		: dateValue(value.timestamp);
	if (activity > 0) state.lastActivity = Math.max(state.lastActivity, activity);
	if (!state.firstMessage && role === "user") {
		state.firstMessage = firstMessageTitle(value.message.content);
	}
}

function firstMessageTitle<Content>(content: Content): string {
	const text = messageText(content);
	const { prompt, paths } = splitLeadingAttachmentReferences(text);
	const promptTitle = prompt.trim();
	if (promptTitle) return summaryText(promptTitle);
	if (paths.length === 1) return summaryText(attachmentDisplayName(paths[0]));
	if (paths.length > 1) return `${paths.length} attachments`;

	const imageCount = Array.isArray(content)
		? content.filter((block) => isRecord(block) && block.type === "image").length
		: 0;
	if (imageCount === 1) return "Image";
	if (imageCount > 1) return `${imageCount} images`;
	return summaryText(text.trim());
}

function messageText<Content>(content: Content): string {
	if (isString(content)) return content;
	if (!Array.isArray(content)) return "";
	const parts: string[] = [];
	for (const block of content) {
		if (isRecord(block) && block.type === "text" && isString(block.text)) {
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

function dateValue<Value>(value: Value): number {
	if (!isString(value)) return 0;
	const parsed = new Date(value).getTime();
	return Number.isNaN(parsed) ? 0 : parsed;
}

function parseCacheEntry<Value>(value: Value): SessionSummaryCacheEntry | undefined {
	return cacheEntryValidator.Check(value) ? value : undefined;
}
