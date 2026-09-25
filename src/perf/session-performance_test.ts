import { afterEach, test } from "bun:test";
import { rm } from "node:fs/promises";

import {
	assertEquals as assertEqual,
	assertStringIncludes as assertIncludes,
	assertThrows,
} from "#testing/assertions";
import { makeTempDir } from "#testing/temp";

import { DatastarClientHub } from "../server/datastar-client-hub.ts";
import { parseClientTransitionPaint } from "../server/routes/session-performance.ts";
import { AppStore } from "../state/app-store.ts";
import type { TranscriptMessageInput } from "../state/transcript-state.ts";
import { assertStringExcludes as assertNotIncludes } from "../testing/assertions.ts";
import { collectElementPatches } from "../testing/element-patches.ts";
import { UiRenderer } from "../ui/ui-renderer.ts";
import {
	appendSessionPerformanceRecord,
	flushSessionPerformanceLog,
} from "./session-performance-log.ts";
import { sessionPerformance } from "./session-performance.ts";

const originalLog = console.log;
const previousPerf = process.env.PI_UI_PERF;
const previousPerfFile = process.env.PI_UI_PERF_FILE;

afterEach(() => {
	console.log = originalLog;
	if (previousPerf === undefined) delete process.env.PI_UI_PERF;
	else process.env.PI_UI_PERF = previousPerf;
	if (previousPerfFile === undefined) delete process.env.PI_UI_PERF_FILE;
	else process.env.PI_UI_PERF_FILE = previousPerfFile;
	sessionPerformance.reset();
});

function capturePerformanceLogs(): string[] {
	const output: string[] = [];
	process.env.PI_UI_PERF = "1";
	sessionPerformance.reset();
	console.log = (value?: Parameters<Console["log"]>[0]) => output.push(String(value));
	return output;
}

test("performance metrics are disabled by default and record no counts", () => {
	delete process.env.PI_UI_PERF;
	sessionPerformance.reset();
	const end = sessionPerformance.startSpan("transcriptProjection");
	end();
	sessionPerformance.recordFatMorph("x".repeat(123));
	const snapshot = sessionPerformance.snapshot();
	assertEqual(snapshot.enabled, false);
	assertEqual(snapshot.fatMorphCount, 0);
	assertEqual(snapshot.bytesRendered, 0);
});

test("performance snapshots retain counts but not rendered content", () => {
	process.env.PI_UI_PERF = "1";
	sessionPerformance.reset();
	const end = sessionPerformance.startSpan("toolEnhancement");
	end();
	sessionPerformance.recordSessionOpen();
	sessionPerformance.recordFatMorph("<main>secret prompt</main>");
	sessionPerformance.recordTargetedMessagePatch("x");
	const serialized = JSON.stringify(sessionPerformance.snapshot());
	assertIncludes(serialized, '"toolEnhancement":{"count":1');
	assertIncludes(serialized, '"logicalSessionOpenCount":1');
	assertIncludes(serialized, '"sdkInternalReadsPerSessionOpenEstimate":2');
	assertIncludes(serialized, '"bytesRendered":27');
	assertNotIncludes(serialized, "secret prompt");
});

test("transition records isolate overlapping spans and reset counters", () => {
	const output = capturePerformanceLogs();

	const first = sessionPerformance.startSessionTransition(12);
	const endFirst = sessionPerformance.startSpan("runtimeServicesCreate", first);
	const second = sessionPerformance.startSessionTransition();
	const endSecond = sessionPerformance.startSpan("runtimeServicesCreate", second);
	endSecond();
	sessionPerformance.recordFatMorph("second", second);
	completeTransition(second);
	endFirst();
	sessionPerformance.recordFatMorph("first", first);
	completeTransition(first);

	assertEqual(output.length, 2);
	const secondRecord = JSON.parse(output[0]);
	const firstRecord = JSON.parse(output[1]);
	assertEqual(secondRecord.transition.id, second);
	assertEqual(firstRecord.transition.id, first);
	assertEqual(firstRecord.transition.generation, 12);
	assertEqual(secondRecord.transition.spans.runtimeServicesCreate.count, 1);
	assertEqual(firstRecord.transition.spans.runtimeServicesCreate.count, 1);
	assertEqual(secondRecord.transition.fatMorphCount, 1);
	assertEqual(firstRecord.transition.fatMorphCount, 1);
	assertEqual(secondRecord.transition.bytesRendered, 6);
	assertEqual(firstRecord.transition.bytesRendered, 5);
	assertEqual(firstRecord.cumulative.fatMorphCount, 2);
});

test("async transition context keeps nested spans on their owner", async () => {
	const output = capturePerformanceLogs();
	let releaseFirst = () => {};
	const wait = new Promise<void>((resolve) => (releaseFirst = resolve));

	const first = sessionPerformance.startSessionTransition();
	const firstWork = sessionPerformance.runInTransition(first, async () => {
		await wait;
		const end = sessionPerformance.startSpan("runtimeSessionCreate");
		end();
	});
	const second = sessionPerformance.startSessionTransition();
	const endSecond = sessionPerformance.startSpan("runtimeSessionCreate");
	endSecond();
	releaseFirst();
	await firstWork;
	completeTransition(second);
	completeTransition(first);

	const records = output.map((line) => JSON.parse(line));
	const firstRecord = records.find((record) => record.transition.id === first);
	const secondRecord = records.find((record) => record.transition.id === second);
	assertEqual(firstRecord.transition.spans.runtimeSessionCreate.count, 1);
	assertEqual(secondRecord.transition.spans.runtimeSessionCreate.count, 1);
});

test("ownership diagnostics record the transition source and background lookup", () => {
	const output = capturePerformanceLogs();
	const transition = sessionPerformance.startSessionTransition();
	sessionPerformance.recordOwnershipDiagnostics(
		{
			sourceGeneration: 7,
			sourceSdkStreaming: false,
			sourceObservedRunning: true,
			sourcePersisted: true,
			leaveAction: "background",
			targetBackgroundLookup: "hit",
			sourceLocationBefore: "foreground",
			sourceLocationAfter: "background-running",
			targetLocationBefore: "background-running",
			targetLocationAfter: "foreground",
			ownedLiveRuntimeCount: 2,
			duplicateKeyInvariantFailures: 0,
		},
		transition,
	);
	completeTransition(transition);

	const record = JSON.parse(output[0]);
	assertEqual(record.transition.ownership.sourceGeneration, 7);
	assertEqual(record.transition.ownership.targetBackgroundLookup, "hit");
	assertEqual(record.transition.backgroundLookupHitCount, 1);
});

test("cancelled transitions emit no record", () => {
	const output = capturePerformanceLogs();
	const transition = sessionPerformance.startSessionTransition();
	const end = sessionPerformance.startSpan("runtimeSwitchCreate", transition);
	sessionPerformance.cancelSessionTransition(transition);
	end();
	assertEqual(output.length, 0);
});

test("client transition metrics validate timing order and bounds", () => {
	assertEqual(
		parseClientTransitionPaint({
			generation: 3,
			clickToLoadingMs: 8,
			clickToMorphMs: 120,
			clickToPaintMs: 145,
		}),
		{
			generation: 3,
			clickToLoadingMs: 8,
			clickToMorphMs: 120,
			clickToPaintMs: 145,
		},
	);
	assertThrows(() =>
		parseClientTransitionPaint({
			generation: 3,
			clickToLoadingMs: 8,
			clickToMorphMs: 150,
			clickToPaintMs: 140,
		}),
	);
});

test("performance records append to the configured JSONL file", async () => {
	const directory = await makeTempDir();
	const path = `${directory}/performance.jsonl`;
	try {
		process.env.PI_UI_PERF_FILE = path;
		appendSessionPerformanceRecord({ id: 1 });
		appendSessionPerformanceRecord({ id: 2 });
		await flushSessionPerformanceLog();
		assertEqual(await Bun.file(path).text(), '{"id":1}\n{"id":2}\n');
	} finally {
		await rm(directory, { recursive: true });
	}
});

test("20-message restore emits fallback once and targets enhancements", async () => {
	process.env.PI_UI_PERF = "1";
	sessionPerformance.reset();
	const state = new AppStore();
	const renderer = new UiRenderer(state, new DatastarClientHub());
	const controller = new AbortController();
	try {
		const response = renderer.createStream(controller.signal);
		state.replaceMessages(generatedSessionFixture(20));
		const summary = await collectElementPatches(response, 18);
		assertEqual(summary.fullPatchCount, 1);
		assertEqual(summary.targetedPatchCount, 17);
		const snapshot = sessionPerformance.snapshot();
		assertEqual(snapshot.fatMorphCount, 2);
		assertEqual(snapshot.targetedMessagePatchCount, 16);
		assertEqual(snapshot.spans.toolEnhancement.count, 8);
		assertEqual(snapshot.spans.markdownEnhancement.count, 8);
	} finally {
		controller.abort();
	}
});

function generatedSessionFixture(count: number): TranscriptMessageInput[] {
	const timestamp = new Date("2026-01-01T00:00:00.000Z");
	return Array.from({ length: count }, (_, index) => {
		switch (index % 5) {
			case 0:
				return { role: "user", text: `Question ${index}`, timestamp };
			case 1:
				return {
					role: "assistant",
					text: `Answer ${index}\n\n\`\`\`ts\nconst value${index} = ${index};\n\`\`\``,
					timestamp,
				};
			case 2:
				return {
					role: "thought",
					text: `Reasoning about fixture ${index}.`,
					timestamp,
				};
			case 3:
				return {
					role: "tool",
					text: `printf 'fixture-${index}\\n'`,
					timestamp,
					format: "code",
					state: "success",
				};
			default:
				return {
					role: "tool",
					text: "@@ -1 +1 @@\n-old\n+new",
					timestamp,
					format: "diff",
					state: "success",
				};
		}
	});
}

function completeTransition(transitionId: number | undefined): void {
	process.env.PI_UI_PERF_FILE = "off";
	sessionPerformance.markTranscriptProjected(transitionId);
	sessionPerformance.markFirstTranscriptPatch(transitionId);
	sessionPerformance.markSessionTransitionComplete(transitionId);
}
