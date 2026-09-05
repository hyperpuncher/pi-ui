import { mkdir, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";

import type { SessionInfo } from "@earendil-works/pi-coding-agent";
import Type, { type Static } from "typebox";
import { Compile } from "typebox/compile";

import { appCachePath } from "../utils/app-cache.ts";
import {
	attachmentDisplayName,
	splitLeadingAttachmentReferences,
} from "../utils/attachment-references.ts";
import { isNotFound } from "../utils/fs-errors.ts";
import type { JsonValue } from "../utils/json-types.ts";
import { isNumber, isRecord, isString } from "../utils/type-guards.ts";

const cacheVersion = 2;
const maxSummaryTextLength = 96;
const decoder = new TextDecoder();
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
		const value = JSON.parse(await Bun.file(path).text());
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
		const pending: Uint8Array[] = [];
		let pendingBytes = 0;
		let consumedBytes = 0;
		while (true) {
			const { done, value: chunk } = await reader.read();
			if (done) break;
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
	}
}

function applyLine(state: SessionSummaryCacheEntry, bytes: Uint8Array): void {
	if (bytes.length === 0) return;
	let value: JsonValue;
	try {
		value = JSON.parse(decoder.decode(bytes));
	} catch {
		return;
	}
	if (!isRecord(value) || !isString(value.type)) return;
	if (value.type === "session" && !state.id) {
		if (!isString(value.id) || !isString(value.timestamp)) return;
		state.id = value.id;
		state.cwd = isString(value.cwd) ? value.cwd : "";
		state.created = dateValue(value.timestamp);
		state.parentSessionPath = isString(value.parentSession)
			? value.parentSession
			: undefined;
		return;
	}
	if (value.type === "session_info") {
		state.name =
			isString(value.name) && value.name.trim()
				? summaryText(value.name.trim())
				: undefined;
		return;
	}
	if (value.type !== "message") return;
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

function parseCacheEntry<Value>(value: Value): SessionSummaryCacheEntry | undefined {
	return cacheEntryValidator.Check(value) ? value : undefined;
}
