import type { AssistantMessage } from "@earendil-works/pi-ai";
import type { SessionEntry } from "@earendil-works/pi-coding-agent";
import { assertEquals, assertMatch } from "@std/assert";

import {
	collectCacheMisses,
	detectCacheMiss,
	formatCacheMissNotice,
} from "./cache-miss.ts";

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
	return {
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
	} as AssistantMessage;
}

function entry(message: AssistantMessage): SessionEntry {
	return {
		type: "message",
		id: crypto.randomUUID(),
		parentId: null,
		timestamp: new Date(message.timestamp).toISOString(),
		message,
	} as unknown as SessionEntry;
}

Deno.test("detects and formats significant cache misses like pi", () => {
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

Deno.test("cache miss collection resets after compaction", () => {
	const before = assistant({ timestamp: 0, input: 10_000, cacheWrite: 40_000 });
	const after = assistant({ timestamp: 1_000, input: 50_000, cacheWrite: 0 });
	const entries = [
		entry(before),
		{ type: "compaction", timestamp: new Date(500).toISOString() },
		entry(after),
	] as unknown as SessionEntry[];
	assertEquals(collectCacheMisses(entries, models).size, 0);
});

Deno.test("hides cache misses below pi's notice thresholds", () => {
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
