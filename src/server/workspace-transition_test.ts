import { transitionWorkspaceResources } from "./workspace-transition.ts";

class FakeResource {
	constructor(
		private readonly name: string,
		private readonly calls: string[],
	) {}

	dispose(): void {
		this.calls.push(`dispose ${this.name}`);
	}
}

Deno.test("workspace transition prepares, commits, then disposes current resources", async () => {
	const calls: string[] = [];
	const replacement = await transitionWorkspaceResources({
		current: {
			host: new FakeResource("current host", calls),
			fileSearch: new FakeResource("current files", calls),
		},
		prepareHost: () => {
			calls.push("prepare host");
			return new FakeResource("next host", calls);
		},
		prepareFileSearch: () => {
			calls.push("prepare files");
			return new FakeResource("next files", calls);
		},
		commit: () => calls.push("commit"),
	});

	assertCalls(calls, [
		"prepare host",
		"prepare files",
		"commit",
		"dispose current host",
		"dispose current files",
	]);
	if (!(replacement.host instanceof FakeResource)) {
		throw new Error("Expected a prepared host");
	}
});

Deno.test("workspace transition preserves current resources when host preparation fails", async () => {
	const calls: string[] = [];
	await expectRejection(() =>
		transitionWorkspaceResources({
			current: {
				host: new FakeResource("current host", calls),
				fileSearch: new FakeResource("current files", calls),
			},
			prepareHost: () => {
				calls.push("prepare host");
				throw new Error("host failed");
			},
			prepareFileSearch: () => {
				calls.push("prepare files");
				return new FakeResource("next files", calls);
			},
			commit: () => calls.push("commit"),
		}),
	);

	assertCalls(calls, ["prepare host"]);
});

Deno.test("workspace transition cleans up a replacement when commit fails", async () => {
	const calls: string[] = [];
	await expectRejection(() =>
		transitionWorkspaceResources({
			current: {
				host: new FakeResource("current host", calls),
				fileSearch: new FakeResource("current files", calls),
			},
			prepareHost: () => new FakeResource("next host", calls),
			prepareFileSearch: () => new FakeResource("next files", calls),
			commit: () => {
				calls.push("commit");
				throw new Error("commit failed");
			},
		}),
	);

	assertCalls(calls, ["commit", "dispose next files", "dispose next host"]);
});

Deno.test("workspace transition disposes a partially prepared replacement", async () => {
	const calls: string[] = [];
	await expectRejection(() =>
		transitionWorkspaceResources({
			current: {
				host: new FakeResource("current host", calls),
				fileSearch: new FakeResource("current files", calls),
			},
			prepareHost: () => {
				calls.push("prepare host");
				return new FakeResource("next host", calls);
			},
			prepareFileSearch: () => {
				calls.push("prepare files");
				throw new Error("file search failed");
			},
			commit: () => calls.push("commit"),
		}),
	);

	assertCalls(calls, ["prepare host", "prepare files", "dispose next host"]);
});

function assertCalls(actual: string[], expected: string[]): void {
	if (JSON.stringify(actual) !== JSON.stringify(expected)) {
		throw new Error(
			`Expected ${JSON.stringify(expected)}, got ${JSON.stringify(actual)}`,
		);
	}
}

async function expectRejection(callback: () => Promise<unknown>): Promise<void> {
	try {
		await callback();
	} catch {
		return;
	}
	throw new Error("Expected promise to reject");
}
