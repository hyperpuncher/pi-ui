import { SessionTransitionController } from "./session-transition-controller.ts";

Deno.test("session transition controller reports success and cancellation", async () => {
	const states: string[] = [];
	const controller = new SessionTransitionController((state) =>
		states.push(state.status),
	);
	assertEquals((await controller.run("one", () => true)).status, "success");
	assertEquals((await controller.run("two", () => false)).status, "cancelled");
	assertEquals(states, ["idle", "loading", "idle", "loading", "idle"]);
});

Deno.test("session transition controller surfaces errors and remains recoverable", async () => {
	const states: Array<{ status: string; message?: string }> = [];
	const controller = new SessionTransitionController((state) => states.push(state));
	assertEquals(
		(
			await controller.run("broken", () => {
				throw new Error("could not load");
			})
		).status,
		"error",
	);
	assertEquals(states.at(-1), {
		status: "error",
		generation: 1,
		targetPath: "broken",
		message: "could not load",
	});
	assertEquals((await controller.run("next", () => true)).status, "success");
});

Deno.test("session transition controller ignores concurrent transitions", async () => {
	let release = () => {};
	const pending = new Promise<void>((resolve) => (release = resolve));
	const controller = new SessionTransitionController(() => {});
	const first = controller.run("one", async () => {
		await pending;
		return true;
	});
	assertEquals((await controller.run("two", () => true)).status, "busy");
	release();
	assertEquals((await first).status, "success");
});

function assertEquals(actual: unknown, expected: unknown): void {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(
			`Expected ${JSON.stringify(expected)}, received ${JSON.stringify(actual)}`,
		);
	}
}
