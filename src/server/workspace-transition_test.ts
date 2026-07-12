import { assertEquals, assertRejects } from "@std/assert";

import { transitionWorkspaceResources } from "./workspace-transition.ts";

class FakeResource {
	constructor(
		private readonly name: string,
		private readonly calls: string[],
		private readonly disposeResult: Promise<void> | Error = Promise.resolve(),
	) {}

	dispose(): Promise<void> {
		this.calls.push(`dispose ${this.name}`);
		if (this.disposeResult instanceof Error) throw this.disposeResult;
		return this.disposeResult;
	}
}

Deno.test("workspace transition prepares, commits, then awaits current host disposal", async () => {
	const calls: string[] = [];
	let release!: () => void;
	const gate = new Promise<void>((resolve) => (release = resolve));
	let settled = false;
	const transition = transitionWorkspaceResources({
		current: { host: new FakeResource("current", calls, gate) },
		prepareHost: () => {
			calls.push("prepare");
			return new FakeResource("next", calls);
		},
		commit: () => calls.push("commit"),
	});
	transition.then(() => (settled = true));
	while (calls.length < 3) await Promise.resolve();
	assertEquals(calls, ["prepare", "commit", "dispose current"]);
	assertEquals(settled, false);
	release();
	await transition;
	assertEquals(settled, true);
});

Deno.test("workspace transition preserves current host when preparation fails", async () => {
	const calls: string[] = [];
	await assertRejects(() =>
		transitionWorkspaceResources({
			current: { host: new FakeResource("current", calls) },
			prepareHost: () => {
				throw new Error("prepare failed");
			},
			commit: () => calls.push("commit"),
		}),
	);
	assertEquals(calls, []);
});

Deno.test("workspace transition disposes replacement when commit fails", async () => {
	const calls: string[] = [];
	await assertRejects(
		() =>
			transitionWorkspaceResources({
				current: { host: new FakeResource("current", calls) },
				prepareHost: () => new FakeResource("next", calls),
				commit: () => {
					calls.push("commit");
					throw new Error("commit failed");
				},
			}),
		Error,
		"commit failed",
	);
	assertEquals(calls, ["commit", "dispose next"]);
});

Deno.test("workspace transition publishes replacement before reporting old cleanup failure", async () => {
	const calls: string[] = [];
	const cleanupFailure = new Error("cleanup failed");
	const visible = { host: new FakeResource("current", calls, cleanupFailure) };
	let reported: AggregateError | undefined;
	const replacement = await transitionWorkspaceResources({
		current: visible,
		prepareHost: () => new FakeResource("next", calls),
		commit: (next) => (visible.host = next),
		onCurrentDisposeError: (error) => (reported = error),
	});
	assertEquals(visible.host, replacement);
	assertEquals(reported?.errors, [cleanupFailure]);
	assertEquals(calls, ["dispose current"]);
});
