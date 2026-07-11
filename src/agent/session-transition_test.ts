import {
	classifySessionLeave,
	transitionRuntime,
	type SessionLeaveAction,
} from "./session-transition.ts";

Deno.test("classify session leave policy", async (t) => {
	const cases: Array<{
		name: string;
		persisted: boolean;
		running: boolean;
		requiresNewRuntime: boolean;
		expected: SessionLeaveAction;
	}> = [
		{
			name: "running persisted",
			persisted: true,
			running: true,
			requiresNewRuntime: true,
			expected: "background",
		},
		{
			name: "running temporary",
			persisted: false,
			running: true,
			requiresNewRuntime: true,
			expected: "discard",
		},
		{
			name: "idle persisted replacement",
			persisted: true,
			running: false,
			requiresNewRuntime: true,
			expected: "dispose",
		},
		{
			name: "idle temporary replacement",
			persisted: false,
			running: false,
			requiresNewRuntime: true,
			expected: "dispose",
		},
		{
			name: "in-place persisted switch",
			persisted: true,
			running: false,
			requiresNewRuntime: false,
			expected: "keep",
		},
	];
	for (const testCase of cases) {
		await t.step(testCase.name, () => {
			const actual = classifySessionLeave(testCase);
			if (actual !== testCase.expected) {
				throw new Error(`Expected ${testCase.expected}, received ${actual}`);
			}
		});
	}
});

function lifecycle(action: SessionLeaveAction, options: { rejectAbort?: boolean } = {}) {
	const events: string[] = [];
	let backgroundCount = 0;
	return {
		events,
		get backgroundCount() {
			return backgroundCount;
		},
		run: () =>
			transitionRuntime({
				action,
				unsubscribe: () => events.push("unsubscribe"),
				abort: () => {
					events.push("abort");
					return options.rejectAbort
						? Promise.reject(new Error("failed"))
						: Promise.resolve();
				},
				dispose: () => events.push("dispose"),
				background: () => {
					backgroundCount += 1;
					events.push("background");
				},
				bindReplacement: () => {
					events.push("bind");
				},
				onAbortError: () => events.push("abort-error"),
			}),
	};
}

Deno.test("discard orders unsubscribe, abort, dispose, and replacement bind", async () => {
	const fake = lifecycle("discard");
	await fake.run();
	assertEvents(fake.events, ["unsubscribe", "abort", "dispose", "bind"]);
	if (fake.backgroundCount !== 0) throw new Error("temporary runtime was backgrounded");
});

Deno.test("abort rejection still disposes and binds replacement", async () => {
	const fake = lifecycle("discard", { rejectAbort: true });
	await fake.run();
	assertEvents(fake.events, ["unsubscribe", "abort", "abort-error", "dispose", "bind"]);
});

Deno.test("running persisted runtime is only backgrounded", async () => {
	const fake = lifecycle("background");
	await fake.run();
	assertEvents(fake.events, ["background", "bind"]);
});

Deno.test("idle replacement is disposed once", async () => {
	const fake = lifecycle("dispose");
	await fake.run();
	assertEvents(fake.events, ["unsubscribe", "dispose", "bind"]);
});

function assertEvents(actual: string[], expected: string[]): void {
	if (actual.join(",") !== expected.join(",")) {
		throw new Error(
			`Expected ${expected.join(" → ")}, received ${actual.join(" → ")}`,
		);
	}
}
