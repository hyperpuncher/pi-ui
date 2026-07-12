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

Deno.test("workspace transition waits for all current resource disposal", async () => {
	const calls: string[] = [];
	let releaseHost!: () => void;
	let releaseFiles!: () => void;
	const hostGate = new Promise<void>((resolve) => {
		releaseHost = resolve;
	});
	const filesGate = new Promise<void>((resolve) => {
		releaseFiles = resolve;
	});
	let settled = false;
	const transition = transitionWorkspaceResources({
		current: {
			host: new FakeResource("current host", calls, hostGate),
			fileSearch: new FakeResource("current files", calls, filesGate),
		},
		prepareHost: () => new FakeResource("next host", calls),
		prepareFileSearch: () => new FakeResource("next files", calls),
		commit: () => calls.push("commit"),
	});
	transition.then(() => {
		settled = true;
	});
	while (calls.length < 3) await Promise.resolve();
	assertCalls(calls, ["commit", "dispose current host", "dispose current files"]);
	releaseHost();
	await Promise.resolve();
	if (settled) throw new Error("Transition settled before every disposal");
	releaseFiles();
	await transition;
	if (!settled) throw new Error("Transition did not settle after disposal");
});

Deno.test("workspace transition publishes replacement before old cleanup and reports cleanup failure", async () => {
	const calls: string[] = [];
	const hostCleanupError = new Error("host cleanup failed");
	const oldHost = new FakeResource("current host", calls, hostCleanupError);
	const oldFiles = new FakeResource("current files", calls);
	const visible: { host: FakeResource; fileSearch: FakeResource } = {
		host: oldHost,
		fileSearch: oldFiles,
	};
	let cleanupError: AggregateError | undefined;
	const replacement = await transitionWorkspaceResources({
		current: visible,
		prepareHost: () => new FakeResource("next host", calls),
		prepareFileSearch: () => new FakeResource("next files", calls),
		commit: (next) => Object.assign(visible, next),
		onCurrentDisposeError: (error) => {
			cleanupError = error;
		},
	});
	if (
		visible.host !== replacement.host ||
		visible.fileSearch !== replacement.fileSearch
	) {
		throw new Error("Replacement ownership was not published");
	}
	if (!cleanupError?.errors.includes(hostCleanupError)) {
		throw new Error("Synchronous cleanup failure was not reported");
	}
	assertCalls(calls, ["dispose current host", "dispose current files"]);
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

Deno.test("workspace transition preserves commit failure when cleanup rejects", async () => {
	const calls: string[] = [];
	try {
		await transitionWorkspaceResources({
			current: {
				host: new FakeResource("current host", calls),
				fileSearch: new FakeResource("current files", calls),
			},
			prepareHost: () =>
				new FakeResource(
					"next host",
					calls,
					Promise.reject(new Error("cleanup failed")),
				),
			prepareFileSearch: () => new FakeResource("next files", calls),
			commit: () => {
				throw new Error("commit failed");
			},
		});
		throw new Error("Expected transition rejection");
	} catch (error) {
		if (!(error instanceof Error) || error.message !== "commit failed") {
			throw error;
		}
	}
	assertCalls(calls, ["dispose next files", "dispose next host"]);
});

Deno.test("workspace transition attempts every replacement cleanup after a synchronous throw", async () => {
	const calls: string[] = [];
	try {
		await transitionWorkspaceResources({
			current: {
				host: new FakeResource("current host", calls),
				fileSearch: new FakeResource("current files", calls),
			},
			prepareHost: () =>
				new FakeResource("next host", calls, new Error("cleanup failed")),
			prepareFileSearch: () => {
				throw new Error("prepare failed");
			},
			commit: () => calls.push("commit"),
		});
		throw new Error("Expected transition rejection");
	} catch (error) {
		if (!(error instanceof Error) || error.message !== "prepare failed") throw error;
	}
	assertCalls(calls, ["dispose next host"]);
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
