import { test } from "bun:test";

import { UsageRequestTracker } from "#src/agent/usage-request.ts";
import { assert } from "#testing/assertions";

const runtime = {};
const session = {};
const model = { provider: "openai-codex", id: "gpt-5" };

test("matches the current request identity", () => {
	const tracker = new UsageRequestTracker();
	const request = tracker.begin(runtime, session, model);
	assert(tracker.owns(request, runtime, session, model));
});

test("rejects an invalidated request", () => {
	const tracker = new UsageRequestTracker();
	const request = tracker.begin(runtime, session, model);
	tracker.invalidate();
	assert(!tracker.owns(request, runtime, session, model));
});

test("rejects changed runtime or session identity", () => {
	const tracker = new UsageRequestTracker();
	const request = tracker.begin(runtime, session, model);
	assert(!tracker.owns(request, {}, session, model));
	assert(!tracker.owns(request, runtime, {}, model));
});

test("rejects a changed provider or model", () => {
	const tracker = new UsageRequestTracker();
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

test("stale completion cannot release a newer request", () => {
	const tracker = new UsageRequestTracker();
	const stale = tracker.begin(runtime, session, model);
	const current = tracker.begin(runtime, session, model);
	assert(!tracker.release(stale, runtime, session, model));
	assert(tracker.loading);
	assert(tracker.release(current, runtime, session, model));
	assert(!tracker.loading);
});
