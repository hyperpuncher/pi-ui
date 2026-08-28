import { test } from "bun:test";

import type { AssistantMessage } from "@earendil-works/pi-ai";

import { assertEquals, assertMatch } from "#testing/assertions";

import {
	collectCacheMisses,
	detectCacheMiss,
	formatCacheMissNotice,
} from "./cache-miss.ts";
import { assistantMessageStub, sessionEntryStub } from "./test-fixtures.ts";

const models = {
	getModel: () => ({ cost: { cacheRead: 0.1 } }),
};

function assistant(options: {
	timestamp: number;
	input: number;
	cacheRead?: number;
	cacheWrite?: number;
	provider?: string;
	model?: string;
}): AssistantMessage {
	const cacheRead = options.cacheRead ?? 0;
	const cacheWrite = options.cacheWrite ?? 0;
	return assistantMessageStub({
		role: "assistant",
		content: [],
		api: "anthropic-messages",
		provider: options.provider ?? "anthropic",
		model: options.model ?? "claude",
		stopReason: "stop",
		timestamp: options.timestamp,
		usage: {
			input: options.input,
			output: 100,
			cacheRead,
			cacheWrite,
			totalTokens: options.input + cacheRead + cacheWrite + 100,
			cost: {
				input: options.input / 100_000,
				output: 0,
				cacheRead: cacheRead / 1_000_000,
				cacheWrite: cacheWrite / 80_000,
				total: 0,
			},
		},
	});
}

function entry(message: AssistantMessage) {
	return sessionEntryStub({
		type: "message",
		timestamp: new Date(message.timestamp).toISOString(),
		message,
	});
}

test("detects and formats significant cache misses like pi", () => {
	const previous = assistant({ timestamp: 0, input: 10_000, cacheWrite: 40_000 });
	const current = assistant({
		timestamp: 6 * 60_000,
		input: 30_000,
		cacheRead: 20_000,
	});
	const miss = detectCacheMiss([entry(previous)], current, models);
	assertEquals(miss?.missedTokens, 30_000);
	assertMatch(
		formatCacheMissNotice(miss!) ?? "",
		/^cache miss after 6m idle: 30k tokens re-billed/,
	);
});

test("cache miss collection resets after compaction", () => {
	const before = assistant({ timestamp: 0, input: 10_000, cacheWrite: 40_000 });
	const after = assistant({ timestamp: 1_000, input: 50_000, cacheWrite: 0 });
	const entries = [
		entry(before),
		sessionEntryStub({
			type: "compaction",
			timestamp: new Date(500).toISOString(),
			summary: "compacted",
			tokensBefore: 0,
		}),
		entry(after),
	];
	assertEquals(collectCacheMisses(entries, models).size, 0);
});

test("hides cache misses below pi's notice thresholds", () => {
	assertEquals(
		formatCacheMissNotice({
			missedTokens: 19_999,
			missedCost: 0.099,
			idleMs: 0,
			modelChanged: false,
		}),
		undefined,
	);
});
