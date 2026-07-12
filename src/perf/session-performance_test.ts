import { AppState } from "../state/app-state.ts";
import {
	collectElementPatches,
	enhancementMessageCount,
	generatedSessionFixture,
	markdownMessageCount,
} from "./session-benchmark.ts";
import { sessionPerformance } from "./session-performance.ts";

Deno.test("performance metrics are disabled by default and retain no content", () => {
	const previous = Deno.env.get("PI_UI_PERF");
	try {
		Deno.env.delete("PI_UI_PERF");
		sessionPerformance.reset();
		const end = sessionPerformance.startSpan("transcriptProjection");
		end();
		sessionPerformance.recordFatMorph("x".repeat(123));
		const snapshot = sessionPerformance.snapshot();
		assertEqual(snapshot.enabled, false);
		assertEqual(snapshot.fatMorphCount, 0);
		assertEqual(snapshot.bytesRendered, 0);
	} finally {
		if (previous === undefined) Deno.env.delete("PI_UI_PERF");
		else Deno.env.set("PI_UI_PERF", previous);
		sessionPerformance.reset();
	}
});

Deno.test("performance snapshots contain durations and counts but no content", () => {
	const previous = Deno.env.get("PI_UI_PERF");
	try {
		Deno.env.set("PI_UI_PERF", "1");
		sessionPerformance.reset();
		const end = sessionPerformance.startSpan("toolEnhancement");
		end();
		sessionPerformance.recordSessionOpen();
		sessionPerformance.recordFatMorph("x".repeat(41));
		sessionPerformance.recordTargetedMessagePatch("x");
		const serialized = JSON.stringify(sessionPerformance.snapshot());
		assertIncludes(serialized, '"toolEnhancement":{"count":1');
		assertIncludes(serialized, '"logicalSessionOpenCount":1');
		assertIncludes(serialized, '"sdkInternalReadsPerSessionOpenEstimate":2');
		assertIncludes(serialized, '"bytesRendered":42');
		for (const sensitive of ["secret prompt", "/home/user/session.jsonl", "<main>"]) {
			assertNotIncludes(serialized, sensitive);
		}
	} finally {
		if (previous === undefined) Deno.env.delete("PI_UI_PERF");
		else Deno.env.set("PI_UI_PERF", previous);
		sessionPerformance.reset();
	}
});

Deno.test("transition records isolate overlapping spans and reset counters", () => {
	const previous = Deno.env.get("PI_UI_PERF");
	const originalLog = console.log;
	const output: string[] = [];
	try {
		Deno.env.set("PI_UI_PERF", "1");
		sessionPerformance.reset();
		console.log = (value?: unknown) => output.push(String(value));

		const first = sessionPerformance.startSessionTransition();
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
		assertEqual(secondRecord.transition.spans.runtimeServicesCreate.count, 1);
		assertEqual(firstRecord.transition.spans.runtimeServicesCreate.count, 1);
		assertEqual(secondRecord.transition.fatMorphCount, 1);
		assertEqual(firstRecord.transition.fatMorphCount, 1);
		assertEqual(secondRecord.transition.bytesRendered, 6);
		assertEqual(firstRecord.transition.bytesRendered, 5);
		assertEqual(firstRecord.cumulative.fatMorphCount, 2);
	} finally {
		console.log = originalLog;
		if (previous === undefined) Deno.env.delete("PI_UI_PERF");
		else Deno.env.set("PI_UI_PERF", previous);
		sessionPerformance.reset();
	}
});

Deno.test("async transition context keeps nested spans on their owner", async () => {
	const previous = Deno.env.get("PI_UI_PERF");
	const originalLog = console.log;
	const output: string[] = [];
	let releaseFirst = () => {};
	const wait = new Promise<void>((resolve) => (releaseFirst = resolve));
	try {
		Deno.env.set("PI_UI_PERF", "1");
		sessionPerformance.reset();
		console.log = (value?: unknown) => output.push(String(value));
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
	} finally {
		console.log = originalLog;
		if (previous === undefined) Deno.env.delete("PI_UI_PERF");
		else Deno.env.set("PI_UI_PERF", previous);
		sessionPerformance.reset();
	}
});

Deno.test("ownership diagnostics are transition-scoped and content-free", () => {
	const previous = Deno.env.get("PI_UI_PERF");
	const originalLog = console.log;
	const output: string[] = [];
	try {
		Deno.env.set("PI_UI_PERF", "1");
		sessionPerformance.reset();
		console.log = (value?: unknown) => output.push(String(value));
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
		const serialized = output[0];
		for (const sensitive of ["/home/user/session.jsonl", "secret prompt"]) {
			assertNotIncludes(serialized, sensitive);
		}
	} finally {
		console.log = originalLog;
		if (previous === undefined) Deno.env.delete("PI_UI_PERF");
		else Deno.env.set("PI_UI_PERF", previous);
		sessionPerformance.reset();
	}
});

Deno.test("cancelled transitions emit no record or sensitive fields", () => {
	const previous = Deno.env.get("PI_UI_PERF");
	const originalLog = console.log;
	const output: string[] = [];
	try {
		Deno.env.set("PI_UI_PERF", "1");
		sessionPerformance.reset();
		console.log = (value?: unknown) => output.push(String(value));
		const transition = sessionPerformance.startSessionTransition();
		const end = sessionPerformance.startSpan("runtimeSwitchCreate", transition);
		sessionPerformance.cancelSessionTransition(transition);
		end();
		assertEqual(output.length, 0);

		const completed = sessionPerformance.startSessionTransition();
		completeTransition(completed);
		const serialized = output[0];
		for (const sensitive of [
			"sessionPath",
			"prompt",
			"credential",
			"extensionArguments",
			"/home/user/session.jsonl",
		]) {
			assertNotIncludes(serialized, sensitive);
		}
	} finally {
		console.log = originalLog;
		if (previous === undefined) Deno.env.delete("PI_UI_PERF");
		else Deno.env.set("PI_UI_PERF", previous);
		sessionPerformance.reset();
	}
});

Deno.test("SSE parser handles event frames split across chunk boundaries", async () => {
	const encoder = new TextEncoder();
	const chunks = [
		"event: datastar-patch-ele",
		'ments\ndata: elements <main id="first">',
		"</main>\n\nevent: datastar-patch-elements\ndata: selector #target\n",
		'data: elements <div id="target"></div>\n\n',
	];
	const response = new Response(
		new ReadableStream({
			start(controller) {
				for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
				controller.close();
			},
		}),
	);
	const summary = await collectElementPatches(response, 2);
	assertEqual(summary.fullPatchCount, 1);
	assertEqual(summary.targetedPatchCount, 1);
});

Deno.test("50-message restore emits fallback once and targets enhancements", async () => {
	const previous = Deno.env.get("PI_UI_PERF");
	Deno.env.set("PI_UI_PERF", "1");
	sessionPerformance.reset();
	const state = new AppState();
	const controller = new AbortController();
	try {
		const response = state.createStream(controller.signal);
		const messages = generatedSessionFixture(50);
		state.replaceMessages(messages);
		const markdownPatches = markdownMessageCount(messages);
		const enhancementPatches = enhancementMessageCount(messages);
		const summary = await collectElementPatches(response, 2 + enhancementPatches);

		assertEqual(markdownPatches, 20);
		assertEqual(enhancementPatches, 40);
		assertEqual(summary.fullPatchCount, 2);
		assertEqual(summary.targetedPatchCount, 40);
		assertIncludes(summary.patches[1], 'data-message-id="m-50"');
		assertNotIncludes(summary.patches[1], "data-pierre-diff");
		assertNotIncludes(summary.patches[1], 'class="pierre-code"');

		const snapshot = sessionPerformance.snapshot();
		assertEqual(snapshot.fatMorphCount, 2);
		assertEqual(snapshot.targetedMessagePatchCount, 40);
		assertEqual(snapshot.spans.toolEnhancement.count, 20);
		assertEqual(snapshot.spans.markdownEnhancement.count, 20);
	} finally {
		controller.abort();
		if (previous === undefined) Deno.env.delete("PI_UI_PERF");
		else Deno.env.set("PI_UI_PERF", previous);
		sessionPerformance.reset();
	}
});

function completeTransition(transitionId: number | undefined): void {
	sessionPerformance.markTranscriptProjected(transitionId);
	sessionPerformance.markFirstTranscriptPatch(transitionId);
	sessionPerformance.markSessionTransitionComplete(transitionId);
}

function assertEqual(actual: unknown, expected: unknown): void {
	if (!Object.is(actual, expected)) {
		throw new Error(`Expected ${String(expected)}, received ${String(actual)}`);
	}
}

function assertIncludes(actual: string, expected: string): void {
	if (!actual.includes(expected)) {
		throw new Error(`Expected output to include ${JSON.stringify(expected)}`);
	}
}

function assertNotIncludes(actual: string, expected: string): void {
	if (actual.includes(expected)) {
		throw new Error(`Expected output not to include ${JSON.stringify(expected)}`);
	}
}
