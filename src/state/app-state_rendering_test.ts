import { collectElementPatches } from "../perf/session-benchmark.ts";
import { renderPage } from "../ui/page.tsx";
import { type AppMessageInput, AppState } from "./app-state.ts";

const timestamp = new Date("2026-01-01T00:00:00.000Z");

Deno.test("restored fallback content patches before bounded enhancements", async () => {
	const gates: Array<{ resolve: (html: string) => void }> = [];
	let active = 0;
	let maximum = 0;
	const order: string[] = [];
	const render = (kind: string) => {
		order.push(kind);
		active += 1;
		maximum = Math.max(maximum, active);
		return new Promise<string>((resolve) =>
			gates.push({
				resolve: (html) => {
					active -= 1;
					resolve(html);
				},
			}),
		);
	};
	const state = new AppState({
		enhancementConcurrency: 2,
		renderMarkdownFinal: () => render("markdown"),
		renderCode: () => render("tool"),
	});
	const controller = new AbortController();
	try {
		const response = state.createStream(controller.signal);
		state.replaceMessages([
			{
				role: "assistant",
				text: '<img src=x onerror="alert(1)"> **answer**',
				timestamp,
			},
			{
				role: "tool",
				text: '<script>alert("tool")</script>',
				timestamp,
				format: "code",
			},
		]);
		const patchesPromise = collectElementPatches(response, 4);
		while (gates.length < 2) await Promise.resolve();
		for (const [index, gate] of gates.entries()) {
			gate.resolve(`<div data-enhanced="${index}">safe</div>`);
		}
		const summary = await patchesPromise;

		assertEqual(maximum, 2);
		assertEqual(order.join(","), "tool,markdown");
		assertEqual(summary.fullPatchCount, 2);
		assertEqual(summary.targetedPatchCount, 2);
		assertIncludes(summary.patches[1], "&lt;img src=x onerror=&#34;alert(1)&#34;>");
		assertIncludes(
			summary.patches[1],
			"&lt;script&gt;alert(&quot;tool&quot;)&lt;/script&gt;",
		);
		assertNotIncludes(summary.patches[1], "data-enhanced");
		assertIncludes(summary.patches[2] + summary.patches[3], "data-enhanced");
	} finally {
		controller.abort();
	}
});

Deno.test("session loading clears after fallback and before enhancement", async () => {
	let resolveEnhancement: ((html: string) => void) | undefined;
	const state = new AppState({
		renderMarkdownFinal: () =>
			new Promise<string>((resolve) => (resolveEnhancement = resolve)),
	});
	const controller = new AbortController();
	try {
		const response = state.createStream(controller.signal);
		const reader = response.body?.getReader();
		if (!reader) throw new Error("Missing response body");
		state.setSessionTransition({
			status: "loading",
			generation: 1,
			targetPath: "/session.jsonl",
		});
		state.replaceMessages([markdownMessage("content ready")]);
		state.setSessionTransition({ status: "idle", generation: 1 });
		const beforeEnhancement = await readUntil(reader, (text) => {
			const loading = text.indexOf('"sessionTransitionLoading":true');
			const fallback = text.indexOf("content ready", loading);
			return (
				loading >= 0 &&
				fallback > loading &&
				text.indexOf('"sessionTransitionLoading":false', fallback) > fallback
			);
		});
		const loading = beforeEnhancement.indexOf('"sessionTransitionLoading":true');
		const fallback = beforeEnhancement.indexOf("content ready", loading);
		const idle = beforeEnhancement.indexOf(
			'"sessionTransitionLoading":false',
			loading + 1,
		);
		if (!(loading >= 0 && fallback > loading && idle > fallback)) {
			throw new Error("Expected loading → fallback → idle ordering");
		}

		resolveEnhancement?.("<p>enhancement ready</p>");
		const enhanced = await readUntil(reader, (text) =>
			text.includes("enhancement ready"),
		);
		assertIncludes(enhanced, "data: selector [data-message-id=");
	} finally {
		controller.abort();
	}
});

Deno.test("loading older pages enqueues only newly revealed messages", async () => {
	let renderCount = 0;
	const state = new AppState({
		renderMarkdownFinal: (text) => {
			renderCount += 1;
			return Promise.resolve(`<p>${text}</p>`);
		},
	});
	state.replaceMessages(
		Array.from({ length: 100 }, (_, index) => markdownMessage(`message ${index}`)),
	);
	await waitFor(() => renderCount === 50);
	assertEqual(state.loadOlderMessages({ broadcast: false }), true);
	await waitFor(() => renderCount === 100);
	assertEqual(state.loadOlderMessages({ broadcast: false }), false);
	assertEqual(renderCount, 100);
});

Deno.test("replacement discards stale enhancement completion", async () => {
	const gates: Array<{ text: string; resolve: (html: string) => void }> = [];
	const state = new AppState({
		enhancementConcurrency: 1,
		renderMarkdownFinal: (text) =>
			new Promise<string>((resolve) => gates.push({ text, resolve })),
	});
	state.replaceMessages([markdownMessage("session A")]);
	while (gates.length < 1) await Promise.resolve();
	state.replaceMessages([markdownMessage("session B")]);
	gates[0].resolve("<p>stale A</p>");
	while (gates.length < 2) await Promise.resolve();
	gates[1].resolve("<p>final B</p>");
	await settleMicrotasks();

	assertEqual(state.messages.length, 1);
	assertEqual(state.messages[0].text, "session B");
	assertEqual(state.messages[0].renderedHtml, "<p>final B</p>");
	assertEqual(state.messages[0].presentationState, "final");
});

Deno.test("enhancement errors retain the safe fallback", async () => {
	const state = new AppState({
		renderMarkdownFinal: () => Promise.reject(new Error("render failed")),
	});
	state.replaceMessages([markdownMessage("<b>fallback</b>")]);
	await settleMicrotasks();
	assertEqual(state.messages[0].renderedHtml, undefined);
	assertEqual(state.messages[0].presentationState, "plain");
	assertIncludes(state.renderMessagesElement(), "&lt;b>fallback&lt;/b>");
});

Deno.test("nested state updates commit one fat morph and one signal patch", async () => {
	const state = new AppState();
	const controller = new AbortController();
	try {
		const response = state.createStream(controller.signal);
		const reader = response.body?.getReader();
		if (!reader) throw new Error("Missing response body");
		await readUntil(reader, (text) => text.includes("event: datastar-patch-signals"));
		state.update(
			() => {
				state.setActivityText("Working...");
				state.update(() => {
					state.setWorkspacePath("/tmp/workspace");
					state.setTemporarySession(true);
				});
				state.setThinking("high", ["off", "high"]);
			},
			{ flush: true },
		);
		const output = await readUntil(
			reader,
			(text) =>
				count(text, "event: datastar-patch-elements") === 1 &&
				count(text, "event: datastar-patch-signals") === 1,
		);

		assertEqual(count(output, "event: datastar-patch-elements"), 1);
		assertEqual(count(output, "event: datastar-patch-signals"), 1);
		assertIncludes(output, '"workspacePath":"/tmp/workspace"');
		assertNotIncludes(output, '"treeEntryId"');
		assertNotIncludes(output, '"modelCycleDirection"');
	} finally {
		controller.abort();
	}
});

Deno.test("a thrown update still commits its completed mutations", async () => {
	const state = new AppState();
	const controller = new AbortController();
	try {
		const response = state.createStream(controller.signal);
		const reader = response.body?.getReader();
		if (!reader) throw new Error("Missing response body");
		await readUntil(reader, (text) => text.includes("event: datastar-patch-signals"));
		try {
			state.update(() => {
				state.workspacePath = "/tmp/committed-before-throw";
				throw new Error("stop");
			});
		} catch {
			// The mutator error is expected; already-applied state remains authoritative.
		}
		const output = await readUntil(reader, (text) =>
			text.includes('"workspacePath":"/tmp/committed-before-throw"'),
		);
		assertEqual(count(output, "event: datastar-patch-elements"), 1);
		assertEqual(count(output, "event: datastar-patch-signals"), 1);
	} finally {
		controller.abort();
	}
});

Deno.test("headless updates initialize one current view and tolerate disconnect", async () => {
	const state = new AppState();
	state.setWorkspacePath("/tmp/headless");
	const controller = new AbortController();
	const response = state.createStream(controller.signal);
	const reader = response.body?.getReader();
	if (!reader) throw new Error("Missing response body");
	const output = await readUntil(reader, (text) =>
		text.includes('"workspacePath":"/tmp/headless"'),
	);
	assertEqual(count(output, "event: datastar-patch-elements"), 1);
	assertEqual(count(output, "event: datastar-patch-signals"), 1);

	controller.abort();
	state.setActivityText("disconnected");
	state.flush();
	assertEqual(state.activityText, "disconnected");
});

Deno.test("scripts from one commit execute in one script patch", async () => {
	const state = new AppState();
	const controller = new AbortController();
	try {
		const response = state.createStream(controller.signal);
		const reader = response.body?.getReader();
		if (!reader) throw new Error("Missing response body");
		await readUntil(reader, (text) => text.includes("event: datastar-patch-signals"));
		state.update(
			() => {
				state.setThinking("high", ["off", "high"]);
				state.setCurrentModel("provider/model");
			},
			{ flush: true },
		);
		const output = await readUntil(reader, (text) =>
			text.includes('<script data-effect="el.remove()">'),
		);
		assertEqual(count(output, '<script data-effect="el.remove()">'), 1);
	} finally {
		controller.abort();
	}
});

Deno.test("fat morphs refresh session picker current and background statuses", async () => {
	const state = new AppState();
	const controller = new AbortController();
	const first = {
		path: "/sessions/first.jsonl",
		cwd: "/workspace",
		title: "First session",
		subtitle: "First subtitle",
		modified: "now",
		backgroundStatus: "running" as const,
	};
	const second = {
		path: "/sessions/second.jsonl",
		cwd: "/workspace",
		title: "Second session",
		subtitle: "Second subtitle",
		modified: "earlier",
	};
	try {
		const response = state.createStream(controller.signal);
		const reader = response.body?.getReader();
		if (!reader) throw new Error("Missing response body");
		await readUntil(reader, (text) => text.includes("event: datastar-patch-signals"));

		state.update(
			() => {
				state.setCurrentSessionPath(first.path);
				state.setSessions([first, second]);
			},
			{ flush: true },
		);
		const running = await readUntil(reader, (text) =>
			text.includes('data-background-status="running"'),
		);
		assertIncludes(running, 'id="session-menu"');
		assertIncludes(running, 'aria-current="true"');
		assertIncludes(running, "First session");

		state.update(
			() => {
				state.setCurrentSessionPath(second.path);
				state.setSessions([{ ...first, backgroundStatus: "completed" }, second]);
			},
			{ flush: true },
		);
		const completed = await readUntil(reader, (text) =>
			text.includes('data-background-status="completed"'),
		);
		assertIncludes(completed, 'id="session-menu"');
		assertIncludes(completed, 'aria-current="true"');
		assertNotIncludes(completed, 'data-background-status="running"');
	} finally {
		controller.abort();
	}
});

Deno.test("fat morph markup preserves browser-owned interaction state", () => {
	const state = new AppState();
	state.replaceMessages([
		{
			role: "compaction",
			text: "summary",
			timestamp,
		},
	]);
	state.flush();
	const html = renderPage(state);

	assertIncludes(html, 'id="prompt-input"');
	assertIncludes(html, 'id="messages"');
	assertIncludes(html, 'id="workspace-dialog"');
	assertIncludes(html, 'id="session-dialog"');
	assertIncludes(html, 'id="model-select"');
	assertIncludes(html, 'data-preserve-attr="open"');
});

function markdownMessage(text: string): AppMessageInput {
	return { role: "assistant", text, timestamp };
}

async function settleMicrotasks(): Promise<void> {
	for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

async function waitFor(complete: () => boolean): Promise<void> {
	for (let index = 0; index < 200; index += 1) {
		if (complete()) return;
		await Promise.resolve();
	}
	throw new Error("Expected asynchronous work did not complete");
}

async function readUntil(
	reader: ReadableStreamDefaultReader<Uint8Array>,
	complete: (text: string) => boolean,
): Promise<string> {
	const decoder = new TextDecoder();
	let output = "";
	for (let index = 0; index < 30; index += 1) {
		const chunk = await reader.read();
		if (chunk.done) break;
		output += decoder.decode(chunk.value, { stream: true });
		if (complete(output)) return output;
	}
	throw new Error("Expected stream output was not received");
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

function count(value: string, search: string): number {
	return value.split(search).length - 1;
}
