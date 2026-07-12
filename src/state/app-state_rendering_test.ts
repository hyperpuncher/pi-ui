import { collectElementPatches } from "../perf/session-benchmark.ts";
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
