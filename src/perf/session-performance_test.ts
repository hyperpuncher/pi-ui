import { AppState } from "../state/app-state.ts";
import {
	collectElementPatches,
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
		sessionPerformance.recordFatMorph("x".repeat(41));
		sessionPerformance.recordTargetedMessagePatch("x");
		const serialized = JSON.stringify(sessionPerformance.snapshot());
		assertIncludes(serialized, '"toolEnhancement":{"count":1');
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

Deno.test("50-message restore characterizes enhancement-first patch amplification", async () => {
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
		const summary = await collectElementPatches(response, 2 + markdownPatches);

		assertEqual(markdownPatches, 20);
		assertEqual(summary.fullPatchCount, 22);
		assertEqual(summary.targetedPatchCount, 0);
		assertIncludes(summary.patches[1], 'data-message-id="m-50"');
		assertIncludes(summary.patches[1], "data-pierre-diff");
		assertIncludes(summary.patches[1], "pierre-code");

		const snapshot = sessionPerformance.snapshot();
		assertEqual(snapshot.fatMorphCount, 22);
		assertEqual(snapshot.targetedMessagePatchCount, 0);
		assertEqual(snapshot.spans.toolEnhancement.count, 20);
		assertEqual(snapshot.spans.markdownEnhancement.count, 20);
	} finally {
		controller.abort();
		if (previous === undefined) Deno.env.delete("PI_UI_PERF");
		else Deno.env.set("PI_UI_PERF", previous);
		sessionPerformance.reset();
	}
});

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
