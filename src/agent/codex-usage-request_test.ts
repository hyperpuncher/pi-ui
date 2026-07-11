import {
	CodexUsageRequestTracker,
	matchesCodexUsageRequest,
} from "./codex-usage-request.ts";

const runtime = {};
const session = {};
const model = { provider: "openai-codex", id: "gpt-5" };

Deno.test("matches the current request identity", () => {
	const tracker = new CodexUsageRequestTracker();
	const request = tracker.begin(runtime, session, model);
	assert(tracker.owns(request, runtime, session, model));
	assert(
		matchesCodexUsageRequest(request, {
			generation: request.generation,
			runtime,
			session,
			model,
		}),
	);
});

Deno.test("rejects a changed generation", () => {
	const tracker = new CodexUsageRequestTracker();
	const request = tracker.begin(runtime, session, model);
	tracker.invalidate();
	assert(!tracker.owns(request, runtime, session, model));
	assert(
		!matchesCodexUsageRequest(request, {
			generation: request.generation + 1,
			runtime,
			session,
			model,
		}),
	);
});

Deno.test("rejects changed runtime or session identity", () => {
	const tracker = new CodexUsageRequestTracker();
	const request = tracker.begin(runtime, session, model);
	assert(!tracker.owns(request, {}, session, model));
	assert(!tracker.owns(request, runtime, {}, model));
});

Deno.test("rejects a changed provider or model", () => {
	const tracker = new CodexUsageRequestTracker();
	const request = tracker.begin(runtime, session, model);
	assert(
		!tracker.owns(request, runtime, session, {
			provider: "anthropic",
			id: model.id,
		}),
	);
	assert(
		!tracker.owns(request, runtime, session, {
			provider: model.provider,
			id: "gpt-5-mini",
		}),
	);
});

Deno.test("stale completion cannot release a newer request", () => {
	const tracker = new CodexUsageRequestTracker();
	const stale = tracker.begin(runtime, session, model);
	const current = tracker.begin(runtime, session, model);
	assert(current.generation > stale.generation);
	assert(!tracker.release(stale, runtime, session, model));
	assert(tracker.loading);
	assert(tracker.release(current, runtime, session, model));
	assert(!tracker.loading);
});

function assert(condition: boolean): void {
	if (!condition) throw new Error("Assertion failed");
}
