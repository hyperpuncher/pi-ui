import { afterEach, test } from "bun:test";
import { rm } from "node:fs/promises";

import {
	appendSessionPerformanceRecord,
	flushSessionPerformanceLog,
} from "#src/perf/session-performance-log.ts";
import { sessionPerformance } from "#src/perf/session-performance.ts";
import { DatastarClientHub } from "#src/server/datastar-client-hub.ts";
import { endpoints } from "#src/server/routes/endpoints.ts";
import {
	parseClientTransitionPaint,
	sessionPerformanceRoutes,
} from "#src/server/routes/session-performance.ts";
import {
	assertEquals as assertEqual,
	assertStringIncludes as assertIncludes,
	assertThrows,
} from "#testing/assertions";
import { assertStringExcludes as assertNotIncludes } from "#testing/assertions";
import { makeTempDir } from "#testing/temp";

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
	process.env.PI_UI_PERF_FILE = "off";
	sessionPerformance.reset();
	console.log = (value?: Parameters<Console["log"]>[0]) => output.push(String(value));
	return output;
}

test("disabled performance hooks run operations without recording or logging", async () => {
	const output: string[] = [];
	console.log = (value) => output.push(String(value));
	delete process.env.PI_UI_PERF;
	sessionPerformance.reset();
	const before = sessionPerformance.snapshot();
	assertEqual(sessionPerformance.startSessionTransition(1), undefined);
	assertEqual(
		sessionPerformance.measureSync("transcriptRender", () => 42),
		42,
	);
	assertEqual(await sessionPerformance.measure("sessionOpen", async () => 43), 43);
	sessionPerformance.recordPatch("transcript", "x".repeat(123), 1);
	sessionPerformance.recordSessionOpen();
	assertEqual(sessionPerformance.transcriptPatchScript(), undefined);
	assertEqual(sessionPerformance.snapshot(), before);
	assertEqual(output, []);
});

test("disabled performance endpoint ignores the request body", async () => {
	delete process.env.PI_UI_PERF;
	const request = new Request("http://localhost/performance", {
		method: "POST",
		body: "not JSON",
	});
	const response =
		await sessionPerformanceRoutes[endpoints.sessionPerformanceClient].POST(request);
	assertEqual(response.status, 204);
});

test("disabled streams contain no performance markers or HTML counts", async () => {
	delete process.env.PI_UI_PERF;
	sessionPerformance.reset();
	const before = sessionPerformance.snapshot();
	const hub = new DatastarClientHub();
	const controller = new AbortController();
	const response = hub.createStream(controller.signal, () => ({
		elements: '<main id="messages">initial</main>',
		signals: "{}",
	}));
	hub.patchElement('<main id="messages">updated</main>', "#messages");
	hub.patchView(() => '<p id="status">ready</p>', "{}", []);
	controller.abort();
	const body = await response.text();
	assertIncludes(body, "updated");
	assertNotIncludes(body, "transcriptPatched");
	assertEqual(sessionPerformance.snapshot(), before);
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
		sessionPerformance.recordPatch("view", "first", 1);
	});
	const second = sessionPerformance.startSessionTransition();
	const endSecond = sessionPerformance.startSpan("runtimeSessionCreate");
	endSecond();
	sessionPerformance.recordPatch("view", "second", 2);
	sessionPerformance.recordOwnershipDiagnostics({ targetBackgroundLookup: "hit" });
	releaseFirst();
	await firstWork;
	sessionPerformance.markSessionTransitionComplete(second);
	sessionPerformance.markSessionTransitionComplete(first);

	const records = output.map((line) => JSON.parse(line));
	const firstRecord = records.find((record) => record.transition.id === first);
	const secondRecord = records.find((record) => record.transition.id === second);
	assertEqual(firstRecord.transition.spans.runtimeSessionCreate.count, 1);
	assertEqual(secondRecord.transition.spans.runtimeSessionCreate.count, 1);
	assertEqual(firstRecord.transition.patches.view.htmlBytes, 5);
	assertEqual(firstRecord.transition.patches.view.deliveries, 1);
	assertEqual(secondRecord.transition.patches.view.htmlBytes, 6);
	assertEqual(secondRecord.transition.patches.view.deliveries, 2);
	assertEqual(secondRecord.transition.backgroundLookupHitCount, 1);
	assertEqual(firstRecord.transition.backgroundLookupHitCount, 0);
});

test("a transition with no connected view completes without inventing a transcript delivery", () => {
	const output = capturePerformanceLogs();
	const id = sessionPerformance.startSessionTransition(2);
	sessionPerformance.markSessionTransitionComplete(id);
	const record = JSON.parse(output[0]);
	assertEqual(record.schemaVersion, 2);
	assertEqual(record.transition.spans.firstTranscriptPatch.count, 0);
	assertEqual(record.transition.spans.runtimeReady.count, 1);
	assertEqual(sessionPerformance.transcriptPatchScript(), undefined);
});

test("two clients receive the same transcript marker without doubling generated HTML", async () => {
	capturePerformanceLogs();
	const hub = new DatastarClientHub();
	const controllers = [new AbortController(), new AbortController()];
	const responses = controllers.map((controller) =>
		hub.createStream(controller.signal, () => ({ elements: "", signals: "{}" })),
	);
	const id = sessionPerformance.startSessionTransition(7);
	// An outgoing/loading transcript is not the selected transcript.
	hub.patchElement('<main id="messages">old</main>', "#messages");
	assertEqual(sessionPerformance.transcriptPatchScript(), undefined);
	sessionPerformance.markTranscriptProjected(id);
	const html = '<main id="messages">新</main>';
	hub.patchElement(html, "#messages");
	hub.patchView(() => '<p id="status">ready</p>', "{}", []);
	const before = sessionPerformance.snapshot();
	assertEqual(before.patches.transcript.count, 2);
	assertEqual(before.patches.transcript.deliveries, 4);
	assertEqual(before.patches.view.count, 1);
	assertEqual(before.patches.view.deliveries, 2);
	assertEqual(
		before.patches.transcript.htmlBytes,
		Buffer.byteLength(html) + Buffer.byteLength('<main id="messages">old</main>'),
	);
	for (const controller of controllers) controller.abort();
	for (const response of responses) {
		const body = await response.text();
		assertEqual(body.split("transcriptPatched(7,").length - 1, 1);
		assertEqual(body.indexOf("transcriptPatched(7,") > body.indexOf("新"), true);
	}
	assertEqual(
		sessionPerformance.snapshot().patches.view.count,
		before.patches.view.count,
	);
	sessionPerformance.markSessionTransitionComplete(id);
});

test("cancelled transitions emit no record", () => {
	const output = capturePerformanceLogs();
	const transition = sessionPerformance.startSessionTransition();
	const end = sessionPerformance.startSpan("runtimeSwitchCreate", transition);
	sessionPerformance.cancelSessionTransition(transition);
	end();
	assertEqual(output.length, 0);
});

test("client transition metrics distinguish content from readiness and validate timings", () => {
	const metrics = {
		runId: "server-a",
		pageId: "browser-a",
		generation: 100_000,
		origin: "command" as const,
		loadingObservedMs: 8,
		firstTranscriptPatchMs: 80,
		firstTranscriptFrameMs: 110,
		readyObservedMs: 120,
		readyFrameMs: 145,
	};
	assertEqual(parseClientTransitionPaint(metrics), metrics);
	for (const patch of [
		{ firstTranscriptFrameMs: 70 },
		{ readyFrameMs: 100 },
		{ loadingObservedMs: 90 },
		{ readyFrameMs: 60_001 },
		{ origin: "unknown" },
		{ pageId: "x".repeat(65) },
	])
		assertThrows(() => parseClientTransitionPaint({ ...metrics, ...patch }));
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
