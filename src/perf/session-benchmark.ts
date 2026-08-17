import { zstdCompressSync } from "node:zlib";

import { DatastarClientHub } from "../server/datastar-client-hub.ts";
import { type AppMessageInput, AppStore } from "../state/app-store.ts";
import {
	StreamingFrameScheduler,
	type StreamingFrameSchedulerClock,
} from "../state/streaming-frame-scheduler.ts";
import { renderMarkdownStreamingMeasured } from "../ui/markdown.tsx";
import { renderMessage } from "../ui/messages.tsx";
import type { AppMessage } from "../ui/render-state.ts";
import { UiRenderer } from "../ui/ui-renderer.ts";
import { sessionPerformance } from "./session-performance.ts";

const architectureBenchmarkSchemaVersion = 1;
const supportedDisplayRates = [60, 75, 90, 100, 120, 144, 165, 240] as const;
const streamingSamplesPerFrame = 8;
const utf8Encoder = new TextEncoder();

export type PatchSummary = {
	fullPatchCount: number;
	targetedPatchCount: number;
	patches: string[];
	patchElapsedMs: number[];
	uncompressedBytes: number;
};

export type ArchitectureBenchmarkOptions = {
	samples?: number;
	messageCounts?: readonly number[];
	clientCounts?: readonly number[];
};

export function generatedSessionFixture(count: number): AppMessageInput[] {
	const timestamp = new Date("2026-01-01T00:00:00.000Z");
	return Array.from({ length: count }, (_, index) => {
		const kind = index % 5;
		if (kind === 0) {
			return { role: "user", text: `Question ${index}`, timestamp };
		}
		if (kind === 1) {
			return {
				role: "assistant",
				text: `Answer ${index}\n\n\`\`\`ts\nconst value${index} = ${index};\n\`\`\``,
				timestamp,
			};
		}
		if (kind === 2) {
			return {
				role: "thought",
				text: `Reasoning about deterministic fixture ${index}.`,
				timestamp,
			};
		}
		if (kind === 3) {
			return {
				role: "tool",
				text: `printf 'fixture-${index}\\n'`,
				timestamp,
				format: "code",
				title: "$ printf",
				state: "success",
			};
		}
		return {
			role: "tool",
			text: `diff --git a/file${index}.ts b/file${index}.ts\n--- a/file${index}.ts\n+++ b/file${index}.ts\n@@ -1 +1 @@\n-old\n+new`,
			timestamp,
			format: "diff",
			title: "edit fixture",
			state: "success",
		};
	});
}

export function markdownMessageCount(messages: readonly AppMessageInput[]): number {
	return messages.filter(
		(message) =>
			["assistant", "thought", "compaction", "skill"].includes(message.role) &&
			message.text.trim(),
	).length;
}

export function enhancementMessageCount(messages: readonly AppMessageInput[]): number {
	return messages.filter(
		(message) =>
			message.text.trim() &&
			(["assistant", "thought", "compaction", "skill"].includes(message.role) ||
				(message.role === "tool" &&
					["code", "diff"].includes(message.format ?? ""))),
	).length;
}

export async function collectElementPatches(
	response: Response,
	count: number,
	startedAt = performance.now(),
): Promise<PatchSummary> {
	const reader = response.body?.getReader();
	if (!reader) throw new Error("Datastar response has no body");
	const decoder = new TextDecoder();
	let buffer = "";
	const patches: string[] = [];
	const patchElapsedMs: number[] = [];
	while (patches.length < count) {
		const chunk = await reader.read();
		if (chunk.done) break;
		buffer += decoder.decode(chunk.value, { stream: true });
		const frames = buffer.split("\n\n");
		buffer = frames.pop() ?? "";
		for (const frame of frames) {
			if (frame.startsWith("event: datastar-patch-elements\n")) {
				patches.push(frame);
				patchElapsedMs.push(performance.now() - startedAt);
				if (patches.length === count) break;
			}
		}
	}
	if (patches.length !== count) {
		throw new Error(`Expected ${count} element patches, received ${patches.length}`);
	}
	return {
		fullPatchCount: patches.filter((patch) => !patch.includes("\ndata: selector "))
			.length,
		targetedPatchCount: patches.filter((patch) => patch.includes("\ndata: selector "))
			.length,
		patches,
		patchElapsedMs,
		uncompressedBytes: patches.reduce(
			(total, patch) => total + utf8Encoder.encode(`${patch}\n\n`).byteLength,
			0,
		),
	};
}

async function runFixture(
	messages: AppMessageInput[],
	concurrency: number,
	clientCount: number,
) {
	sessionPerformance.reset();
	const state = new AppStore();
	const renderer = new UiRenderer(state, new DatastarClientHub(), {
		enhancementConcurrency: concurrency,
	});
	const controllers = Array.from({ length: clientCount }, () => new AbortController());
	const responses = controllers.map((controller) =>
		renderer.createStream(controller.signal),
	);
	const expectedPatches = 3 + enhancementMessageCount(messages.slice(-50));
	const startedAt = performance.now();
	state.replaceMessages(messages);
	let summaries: PatchSummary[];
	try {
		summaries = await Promise.all(
			responses.map((response) =>
				collectElementPatches(response, expectedPatches, startedAt),
			),
		);
	} finally {
		for (const controller of controllers) controller.abort();
	}
	const enhancementCompleteMs = performance.now() - startedAt;
	const snapshot = sessionPerformance.snapshot();
	const elementPatchBytes = summaries.reduce(
		(total, summary) => total + summary.uncompressedBytes,
		0,
	);
	return {
		firstContentMs: Math.max(
			...summaries.map((summary) => summary.patchElapsedMs[1]),
		),
		enhancementCompleteMs,
		renderedHtmlBytes: snapshot.bytesRendered,
		elementPatchBytes,
		batchZstdElementPatchBytes: batchZstdSize(
			summaries.flatMap((summary) => summary.patches).join("\n\n"),
		),
		fullPatchCount: summaries.reduce(
			(total, summary) => total + summary.fullPatchCount,
			0,
		),
		targetedPatchCount: summaries.reduce(
			(total, summary) => total + summary.targetedPatchCount,
			0,
		),
	};
}

export function percentile(values: readonly number[], fraction: number): number {
	const sorted = values.toSorted((left, right) => left - right);
	return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
}

type StreamingFrameSample = {
	markdownParseMs: number;
	codeBlockRenderMs: number;
	kitaRenderMs: number;
	sseEncodeMs: number;
	totalMs: number;
};

function streamingFixtures(): Array<{ name: string; markdown: string }> {
	const prose = "Growing prose with **formatting**, links, and punctuation. ";
	return [
		{ name: "growing-prose-1kb", markdown: prose.repeat(20).slice(0, 1024) },
		{
			name: "growing-prose-10kb",
			markdown: prose.repeat(200).slice(0, 10 * 1024),
		},
		{
			name: "growing-prose-50kb",
			markdown: prose.repeat(1000).slice(0, 50 * 1024),
		},
		{
			name: "incomplete-markdown",
			markdown: `${prose.repeat(40)}\n\n[unfinished](https://example`,
		},
		{
			name: "fenced-code",
			markdown: `\`\`\`ts\n${"const value = 1;\n".repeat(300)}\`\`\``,
		},
		{
			name: "tables",
			markdown: `| Name | Value |\n| --- | --- |\n${"| frame | measured |\n".repeat(300)}`,
		},
		{
			name: "mixed-thought-assistant",
			markdown: `## Thought\n${prose.repeat(80)}\n\n## Assistant\n${prose.repeat(80)}`,
		},
	];
}

function benchmarkStreamingFrames() {
	return streamingFixtures().map((fixture) => {
		const samples: StreamingFrameSample[] = [];
		for (let frame = 1; frame <= 6; frame += 1) {
			const markdown = fixture.markdown.slice(
				0,
				Math.max(1, Math.ceil((fixture.markdown.length * frame) / 6)),
			);
			for (
				let repetition = 0;
				repetition < streamingSamplesPerFrame;
				repetition += 1
			) {
				const measured = renderMarkdownStreamingMeasured(markdown);
				const message: AppMessage = {
					id: `benchmark-${fixture.name}`,
					role:
						fixture.name === "mixed-thought-assistant"
							? "thought"
							: "assistant",
					text: markdown,
					timestamp: new Date(0),
					renderedHtml: measured.html,
					presentationState: "streaming",
					presentationVersion: frame * streamingSamplesPerFrame + repetition,
				};
				const kitaStartedAt = performance.now();
				const element = renderMessage(message);
				const kitaRenderMs = performance.now() - kitaStartedAt;
				const encodeStartedAt = performance.now();
				utf8Encoder.encode(
					`event: datastar-patch-elements\ndata: elements ${element}\n\n`,
				);
				const sseEncodeMs = performance.now() - encodeStartedAt;
				const totalMs =
					measured.markdownParseMs +
					measured.codeBlockRenderMs +
					kitaRenderMs +
					sseEncodeMs;
				samples.push({
					markdownParseMs: measured.markdownParseMs,
					codeBlockRenderMs: measured.codeBlockRenderMs,
					kitaRenderMs,
					sseEncodeMs,
					totalMs,
				});
			}
		}
		const stage = (key: keyof StreamingFrameSample) => ({
			p50Ms: percentile(
				samples.map((sample) => sample[key]),
				0.5,
			),
			p95Ms: percentile(
				samples.map((sample) => sample[key]),
				0.95,
			),
		});
		return {
			name: fixture.name,
			bytes: utf8Encoder.encode(fixture.markdown).byteLength,
			frameCount: samples.length,
			stages: {
				markdownParse: stage("markdownParseMs"),
				codeBlockRender: stage("codeBlockRenderMs"),
				kitaRender: stage("kitaRenderMs"),
				sseEncode: stage("sseEncodeMs"),
				browserMorph: null,
				total: stage("totalMs"),
			},
			deadlineMisses: Object.fromEntries(
				supportedDisplayRates.map((hz) => [
					hz,
					samples.filter((sample) => sample.totalMs > 1000 / hz).length,
				]),
			),
		};
	});
}

function benchmarkScheduler() {
	return supportedDisplayRates.flatMap((hz) =>
		[1, 4, 8].map((renderCostMs) => {
			const clock = new BenchmarkClock();
			const scheduler = new StreamingFrameScheduler<number>(
				() => clock.consume(renderCostMs),
				clock,
				0,
			);
			scheduler.setDisplayHz(hz);
			const sourceIntervalMs = 1000 / (hz * 2);
			for (let update = 0; update < hz * 2; update += 1) {
				clock.advanceTo(update * sourceIntervalMs);
				scheduler.schedule(update);
			}
			clock.advanceTo(1000);
			scheduler.flush();
			return {
				hz,
				renderCostMs,
				targetIntervalMs: scheduler.targetIntervalMs,
				sourceUpdates: hz * 2,
				maximumQueuedFrames: 1,
				...scheduler.stats,
			};
		}),
	);
}

async function benchmarkSessionRestores(
	samplesPerFixture: number,
	messageCounts: readonly number[],
	clientCounts: readonly number[],
) {
	const fixtures = [];
	for (const clientCount of clientCounts) {
		for (const concurrency of [1, 2, 4]) {
			for (const messageCount of messageCounts) {
				const samples = [];
				for (let sample = 0; sample < samplesPerFixture; sample += 1) {
					samples.push(
						await runFixture(
							generatedSessionFixture(messageCount),
							concurrency,
							clientCount,
						),
					);
				}
				fixtures.push({
					clientCount,
					concurrency,
					messageCount,
					firstContentP50Ms: percentile(
						samples.map((sample) => sample.firstContentMs),
						0.5,
					),
					firstContentP95Ms: percentile(
						samples.map((sample) => sample.firstContentMs),
						0.95,
					),
					enhancementCompleteP50Ms: percentile(
						samples.map((sample) => sample.enhancementCompleteMs),
						0.5,
					),
					enhancementCompleteP95Ms: percentile(
						samples.map((sample) => sample.enhancementCompleteMs),
						0.95,
					),
					renderedHtmlBytes: Math.max(
						...samples.map((sample) => sample.renderedHtmlBytes),
					),
					elementPatchBytes: Math.max(
						...samples.map((sample) => sample.elementPatchBytes),
					),
					batchZstdElementPatchBytes: Math.max(
						...samples.map((sample) => sample.batchZstdElementPatchBytes),
					),
					fullPatchCount: Math.max(
						...samples.map((sample) => sample.fullPatchCount),
					),
					targetedPatchCount: Math.max(
						...samples.map((sample) => sample.targetedPatchCount),
					),
				});
			}
		}
	}
	return fixtures;
}

async function fixtureSizes(): Promise<number[]> {
	const sessionPath = Deno.env.get("PI_UI_BENCH_SESSION");
	if (!sessionPath) return [10, 50, 100, 200];
	const text = await Deno.readTextFile(sessionPath);
	return [Math.max(1, text.split("\n").filter((line) => line.trim()).length)];
}

export async function runArchitectureBenchmark(
	options: ArchitectureBenchmarkOptions = {},
) {
	const samples = options.samples ?? 5;
	const messageCounts = options.messageCounts ?? (await fixtureSizes());
	const clientCounts = options.clientCounts ?? [1, 2];
	Deno.env.set("PI_UI_PERF", "1");
	return {
		type: "pi-ui-architecture-benchmark",
		schemaVersion: architectureBenchmarkSchemaVersion,
		generatedAt: new Date().toISOString(),
		runtime: {
			deno: Deno.version.deno,
			v8: Deno.version.v8,
			os: Deno.build.os,
			arch: Deno.build.arch,
		},
		configuration: {
			samples,
			messageCounts,
			clientCounts,
			supportedDisplayRates,
			streamingSamplesPerFrame,
		},
		streamingFrames: benchmarkStreamingFrames(),
		scheduler: benchmarkScheduler(),
		sessionLoading: {
			logicalOpenCountInstrumented: true,
			sdkInternalReadsPerSessionOpenEstimate:
				sessionPerformance.snapshot().sdkInternalReadsPerSessionOpenEstimate,
			fixtures: await benchmarkSessionRestores(
				samples,
				messageCounts,
				clientCounts,
			),
		},
	};
}

function batchZstdSize(value: string): number {
	return zstdCompressSync(value).byteLength;
}

class BenchmarkClock implements StreamingFrameSchedulerClock {
	private time = 0;
	private sequence = 0;
	private timers = new Map<number, { at: number; callback: () => void }>();

	readonly now = (): number => this.time;
	readonly setTimer = (callback: () => void, delayMs: number): number => {
		const id = ++this.sequence;
		this.timers.set(id, { at: this.time + delayMs, callback });
		return id;
	};
	readonly clearTimer = (id: number): void => {
		this.timers.delete(id);
	};

	advanceTo(target: number): void {
		while (true) {
			const next = [...this.timers.entries()].toSorted(
				(left, right) => left[1].at - right[1].at,
			)[0];
			if (!next || next[1].at > target || this.time > target) break;
			this.time = Math.max(this.time, next[1].at);
			this.timers.delete(next[0]);
			next[1].callback();
		}
		this.time = Math.max(this.time, target);
	}

	consume(durationMs: number): void {
		this.time += durationMs;
	}
}

type ArchitectureBenchmarkCliOptions = {
	benchmark: ArchitectureBenchmarkOptions;
	output?: string;
};

function readCliOptions(args: readonly string[]): ArchitectureBenchmarkCliOptions {
	let samples: number | undefined;
	let output: string | undefined;
	for (let index = 0; index < args.length; index += 1) {
		if (args[index] === "--samples") {
			samples = Number(args[++index]);
			if (!Number.isInteger(samples) || samples < 1) {
				throw new Error("--samples must be a positive integer");
			}
		} else if (args[index] === "--output") {
			output = args[++index];
			if (!output) throw new Error("--output requires a path");
		} else {
			throw new Error(`Unknown argument: ${args[index]}`);
		}
	}
	return { benchmark: { samples }, output };
}

if (import.meta.main) {
	const options = readCliOptions(Deno.args);
	const result = await runArchitectureBenchmark(options.benchmark);
	const json = `${JSON.stringify(result)}\n`;
	if (options.output) await Deno.writeTextFile(options.output, json);
	else await Deno.stdout.write(utf8Encoder.encode(json));
}
