import { mkdir, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";

import type { SessionInfo } from "@earendil-works/pi-coding-agent";
import { compile, num, obj, opt, type Static, str } from "@earendil-works/pi-schema";

import { textContent } from "#src/agent/content-text.ts";
import { appCachePath } from "#src/utils/app-dirs.ts";
import {
	attachmentDisplayName,
	splitLeadingAttachmentReferences,
} from "#src/utils/attachment-references.ts";
import { truncate } from "#src/utils/format.ts";
import { isNotFound } from "#src/utils/fs-errors.ts";
import { isNumber, isRecord, isString, type JsonRecord } from "#src/utils/type-guards.ts";

const cacheVersion = 2;
const maxSummaryTextLength = 96;
const cacheWrites = new Map<string, Promise<void>>();
const prefixType = Buffer.from('{"type":"');
const prefixSession = Buffer.from('{"type":"session",');
const prefixSessionInfo = Buffer.from('{"type":"session_info",');
const prefixMessage = Buffer.from('{"type":"message",');
const needleMessageRole = Buffer.from('"message":{"role":"');
const needleStopReason = Buffer.from(',"stopReason":"');
const needleTimestamp = Buffer.from(',"timestamp":');
const cacheEntrySchema = obj(
	{
		indexedBytes: num(),
		mtime: num(),
		id: str(),
		cwd: str(),
		name: opt(str()),
		firstMessage: str(),
		messageCount: num(),
		lastActivity: num(),
		created: num(),
		parentSessionPath: opt(str()),
	},
	{ open: true },
);
const cacheEntryValidator = compile(cacheEntrySchema);

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
		const bytes = await Bun.file(candidate.path).slice(start).bytes();
		const lastNewline = bytes.lastIndexOf(10);
		if (lastNewline >= 0) {
			applyCompleteLines(state, bytes, lastNewline);
		}
		if (!cached && !state.id) return undefined;
		state.indexedBytes = start + (lastNewline >= 0 ? lastNewline + 1 : 0);
		state.mtime = candidate.mtime;
		return state;
	} catch {
		return undefined;
	}
}

/**
 * Scans complete JSONL lines in-place, skipping JSON deserialization for
 * non-summary records and already-titled message payloads while falling back
 * to full JSON parsing for headers, renames, the first user prompt, or any
 * unusual formatting.
 */
function applyCompleteLines(
	state: SessionSummaryCacheEntry,
	bytes: Uint8Array,
	lastNewline: number,
): void {
	const buf = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
	for (let start = 0; start <= lastNewline;) {
		const newline = buf.indexOf(10, start);
		if (newline > start) {
			if (hasPrefix(buf, start, newline, prefixMessage)) {
				if (!applyFastMessageLine(state, buf, start, newline)) {
					parseAndApplyLine(state, bytes, start, newline);
				}
			} else if (
				hasPrefix(buf, start, newline, prefixSession) ||
				hasPrefix(buf, start, newline, prefixSessionInfo) ||
				!hasPrefix(buf, start, newline, prefixType)
			) {
				parseAndApplyLine(state, bytes, start, newline);
			}
		}
		start = newline + 1;
	}
}

function parseAndApplyLine(
	state: SessionSummaryCacheEntry,
	bytes: Uint8Array,
	start: number,
	end: number,
): void {
	const parsed = Bun.JSONL.parseChunk(bytes, start, end);
	if (parsed.error) return;
	for (const value of parsed.values) {
		if (isRecord(value)) applyRecord(state, value);
	}
}

function applyFastMessageLine(
	state: SessionSummaryCacheEntry,
	buf: Buffer,
	start: number,
	end: number,
): boolean {
	const lineEnd = end > start && buf[end - 1] === 13 ? end - 1 : end;
	if (lineEnd - start < 24 || buf[lineEnd - 1] !== 125) return false;

	const headLimit = Math.min(lineEnd, start + 512);
	const rolePos = buf.indexOf(needleMessageRole, start + prefixMessage.length);
	if (rolePos === -1 || rolePos >= headLimit) return false;

	const roleStart = rolePos + needleMessageRole.length;
	const roleEnd = buf.indexOf(34, roleStart);
	if (roleEnd === -1 || roleEnd > headLimit) return false;

	const role = buf.toString("ascii", roleStart, roleEnd);
	const isUser = role === "user";
	const isAssistant = role === "assistant";

	// First user message needs full content parsing for title/attachments/images.
	if (isUser && !state.firstMessage) return false;

	if (!isUser && !isAssistant) {
		state.messageCount += 1;
		return true;
	}

	const activity = extractMessageTimestamp(buf, roleEnd, lineEnd);
	if (activity === undefined) return false;

	state.messageCount += 1;
	if (activity > state.lastActivity) state.lastActivity = activity;
	return true;
}

function extractMessageTimestamp(
	buf: Buffer,
	minPos: number,
	lineEnd: number,
): number | undefined {
	// Fast case 1: line ends with ,"timestamp":<digits>}}
	const tailStart = Math.max(minPos, lineEnd - 48);
	const endTsPos = buf.lastIndexOf(needleTimestamp, lineEnd - needleTimestamp.length);
	if (endTsPos >= tailStart) {
		const parsed = parsePositiveInt(buf, endTsPos + needleTimestamp.length, lineEnd);
		if (
			parsed &&
			parsed.end + 2 === lineEnd &&
			buf[parsed.end] === 125 &&
			buf[parsed.end + 1] === 125
		) {
			return parsed.value;
		}
	}

	// Fast case 2: assistant metadata after ,"stopReason":"...","timestamp":<digits>
	const metaStart = Math.max(minPos, lineEnd - 1024);
	const stopPos = buf.lastIndexOf(needleStopReason, lineEnd - needleStopReason.length);
	if (stopPos >= metaStart) {
		const tsPos = buf.indexOf(needleTimestamp, stopPos + needleStopReason.length);
		if (tsPos !== -1 && tsPos < lineEnd) {
			const parsed = parsePositiveInt(buf, tsPos + needleTimestamp.length, lineEnd);
			if (
				parsed &&
				parsed.end < lineEnd &&
				(buf[parsed.end] === 44 || buf[parsed.end] === 125)
			) {
				return parsed.value;
			}
		}
	}

	return undefined;
}

function parsePositiveInt(
	buf: Buffer,
	start: number,
	end: number,
): { value: number; end: number } | undefined {
	let pos = start;
	let value = 0;
	while (pos < end) {
		const ch = buf[pos];
		if (ch < 48 || ch > 57) break;
		value = value * 10 + (ch - 48);
		pos += 1;
	}
	return pos > start ? { value, end: pos } : undefined;
}

function hasPrefix(buf: Buffer, offset: number, end: number, prefix: Buffer): boolean {
	return (
		end - offset >= prefix.length &&
		buf.compare(prefix, 0, prefix.length, offset, offset + prefix.length) === 0
	);
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
			? truncate(value.name.trim(), maxSummaryTextLength)
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
	const text = textContent(content);
	const { prompt, paths } = splitLeadingAttachmentReferences(text);
	const promptTitle = prompt.trim();
	if (promptTitle) return truncate(promptTitle, maxSummaryTextLength);
	if (paths.length === 1)
		return truncate(attachmentDisplayName(paths[0]), maxSummaryTextLength);
	if (paths.length > 1) return `${paths.length} attachments`;

	const imageCount = Array.isArray(content)
		? content.filter((block) => isRecord(block) && block.type === "image").length
		: 0;
	if (imageCount === 1) return "Image";
	if (imageCount > 1) return `${imageCount} images`;
	return truncate(text.trim(), maxSummaryTextLength);
}

function dateValue<Value>(value: Value): number {
	if (!isString(value)) return 0;
	const parsed = new Date(value).getTime();
	return Number.isNaN(parsed) ? 0 : parsed;
}

function parseCacheEntry<Value>(value: Value): SessionSummaryCacheEntry | undefined {
	return cacheEntryValidator.check(value) ? value : undefined;
}
