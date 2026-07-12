import { AppState, type AppMessageInput } from "../state/app-state.ts";
import { sessionPerformance } from "./session-performance.ts";

export type PatchSummary = {
	fullPatchCount: number;
	targetedPatchCount: number;
	patches: string[];
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

export async function collectElementPatches(
	response: Response,
	count: number,
): Promise<PatchSummary> {
	const reader = response.body?.getReader();
	if (!reader) throw new Error("Datastar response has no body");
	const decoder = new TextDecoder();
	let buffer = "";
	const patches: string[] = [];
	while (patches.length < count) {
		const chunk = await reader.read();
		if (chunk.done) break;
		buffer += decoder.decode(chunk.value, { stream: true });
		const frames = buffer.split("\n\n");
		buffer = frames.pop() ?? "";
		for (const frame of frames) {
			if (frame.startsWith("event: datastar-patch-elements\n")) {
				patches.push(frame);
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
	};
}

async function runFixture(messages: AppMessageInput[]) {
	sessionPerformance.reset();
	const state = new AppState();
	const controller = new AbortController();
	const response = state.createStream(controller.signal);
	const expectedPatches = 2 + markdownMessageCount(messages.slice(-50));
	const startedAt = performance.now();
	state.replaceMessages(messages);
	const patches = await collectElementPatches(response, expectedPatches);
	const elapsedMs = performance.now() - startedAt;
	controller.abort();
	const snapshot = sessionPerformance.snapshot();
	return {
		elapsedMs,
		outputBytes: snapshot.bytesRendered,
		fullPatchCount: patches.fullPatchCount,
		targetedPatchCount: patches.targetedPatchCount,
	};
}

function percentile(values: number[], fraction: number): number {
	const sorted = values.toSorted((a, b) => a - b);
	return sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1)];
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
	for (const messageCount of await fixtureSizes()) {
		const samples = [];
		for (let sample = 0; sample < 3; sample += 1) {
			samples.push(await runFixture(generatedSessionFixture(messageCount)));
		}
		fixtures.push({
			messageCount,
			p50Ms: percentile(
				samples.map((sample) => sample.elapsedMs),
				0.5,
			),
			p95Ms: percentile(
				samples.map((sample) => sample.elapsedMs),
				0.95,
			),
			outputBytes: Math.max(...samples.map((sample) => sample.outputBytes)),
			fullPatchCount: Math.max(...samples.map((sample) => sample.fullPatchCount)),
			targetedPatchCount: Math.max(
				...samples.map((sample) => sample.targetedPatchCount),
			),
		});
	}
	console.log(
		JSON.stringify({
			type: "pi-ui-session-benchmark",
			samples: 3,
			sessionLoading: {
				logicalOpenCountInstrumented: true,
				sdkInternalReadsPerSessionOpenEstimate:
					sessionPerformance.snapshot().sdkInternalReadsPerSessionOpenEstimate,
			},
			fixtures,
		}),
	);
}
