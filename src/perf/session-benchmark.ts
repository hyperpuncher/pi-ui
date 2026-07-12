import { type AppMessage, type AppMessageInput, AppState } from "../state/app-state.ts";
import { renderMarkdownStreamingMeasured } from "../ui/markdown.tsx";
import { renderMessage } from "../ui/messages.tsx";
import { sessionPerformance } from "./session-performance.ts";

export type PatchSummary = {
	fullPatchCount: number;
	targetedPatchCount: number;
	patches: string[];
	patchElapsedMs: number[];
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
	};
}

async function runFixture(messages: AppMessageInput[], concurrency: number) {
	sessionPerformance.reset();
	const state = new AppState({ enhancementConcurrency: concurrency });
	const controller = new AbortController();
	const response = state.createStream(controller.signal);
	const expectedPatches = 2 + enhancementMessageCount(messages.slice(-50));
	const startedAt = performance.now();
	state.replaceMessages(messages);
	const patches = await collectElementPatches(response, expectedPatches, startedAt);
	const enhancementCompleteMs = performance.now() - startedAt;
	controller.abort();
	const snapshot = sessionPerformance.snapshot();
	return {
		firstContentMs: patches.patchElapsedMs[1],
		enhancementCompleteMs,
		outputBytes: snapshot.bytesRendered,
		fullPatchCount: patches.fullPatchCount,
		targetedPatchCount: patches.targetedPatchCount,
	};
}

function percentile(values: number[], fraction: number): number {
	const sorted = values.toSorted((a, b) => a - b);
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
		{ name: "growing-prose-10kb", markdown: prose.repeat(200).slice(0, 10 * 1024) },
		{ name: "growing-prose-50kb", markdown: prose.repeat(1000).slice(0, 50 * 1024) },
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
			const measured = renderMarkdownStreamingMeasured(markdown);
			const message: AppMessage = {
				id: `benchmark-${fixture.name}`,
				role:
					fixture.name === "mixed-thought-assistant" ? "thought" : "assistant",
				text: markdown,
				timestamp: new Date(0),
				renderedHtml: measured.html,
				presentationState: "streaming",
				presentationVersion: frame,
			};
			const kitaStartedAt = performance.now();
			const element = renderMessage(message);
			const kitaRenderMs = performance.now() - kitaStartedAt;
			const encodeStartedAt = performance.now();
			new TextEncoder().encode(
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
			bytes: new TextEncoder().encode(fixture.markdown).byteLength,
			frameCount: samples.length,
			stages: {
				markdownParse: stage("markdownParseMs"),
				codeBlockRender: stage("codeBlockRenderMs"),
				kitaRender: stage("kitaRenderMs"),
				sseEncode: stage("sseEncodeMs"),
				browserMorph: null,
				total: stage("totalMs"),
			},
			droppedAt60Hz: samples.filter((sample) => sample.totalMs > 1000 / 60).length,
			droppedAt144Hz: samples.filter((sample) => sample.totalMs > 1000 / 144)
				.length,
			coalescedFrameCount: 0,
			maximumQueuedFrames: 1,
		};
	});
}

async function fixtureSizes(): Promise<number[]> {
	const sessionPath = Deno.env.get("PI_UI_BENCH_SESSION");
	if (!sessionPath) return [10, 50, 200];
	const text = await Deno.readTextFile(sessionPath);
	return [Math.max(1, text.split("\n").filter((line) => line.trim()).length)];
}

if (import.meta.main) {
	Deno.env.set("PI_UI_PERF", "1");
	const fixtures = [];
	for (const concurrency of [1, 2, 4]) {
		for (const messageCount of await fixtureSizes()) {
			const samples = [];
			for (let sample = 0; sample < 3; sample += 1) {
				samples.push(
					await runFixture(generatedSessionFixture(messageCount), concurrency),
				);
			}
			fixtures.push({
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
				outputBytes: Math.max(...samples.map((sample) => sample.outputBytes)),
				fullPatchCount: Math.max(
					...samples.map((sample) => sample.fullPatchCount),
				),
				targetedPatchCount: Math.max(
					...samples.map((sample) => sample.targetedPatchCount),
				),
			});
		}
	}
	console.log(
		JSON.stringify({
			type: "pi-ui-session-benchmark",
			samples: 3,
			streamingFrames: benchmarkStreamingFrames(),
			sessionLoading: {
				logicalOpenCountInstrumented: true,
				sdkInternalReadsPerSessionOpenEstimate:
					sessionPerformance.snapshot().sdkInternalReadsPerSessionOpenEstimate,
			},
			fixtures,
		}),
	);
}
