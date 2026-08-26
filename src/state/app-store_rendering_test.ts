import {
	assert,
	assertEquals as assertEqual,
	assertStringIncludes as assertIncludes,
} from "@std/assert";

import { DatastarClientHub } from "../server/datastar-client-hub.ts";
import { assertStringExcludes as assertNotIncludes } from "../testing/assertions.ts";
import { collectElementPatches } from "../testing/element-patches.ts";
import { projectBackendSignals } from "../ui/backend-signals.ts";
import type { MessageRenderServiceOptions } from "../ui/message-render-service.ts";
import { renderPage } from "../ui/page.tsx";
import { UiRenderer } from "../ui/ui-renderer.ts";
import { type AppMessageInput, AppStore } from "./app-store.ts";
import { TranscriptState } from "./transcript-state.ts";

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
	const state = createState({
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
		assertEqual(summary.fullPatchCount, 1);
		assertEqual(summary.targetedPatchCount, 3);
		assertIncludes(summary.patches[1], "data: selector #messages");
		assertIncludes(summary.patches[1], "data: mode replace");
		assertIncludes(summary.patches[1], "<strong>answer</strong>");
		assertNotIncludes(summary.patches[1], "<img");
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

Deno.test("ordinary commits exclude finalized assistant messages", async () => {
	let resolveEnhancement: ((html: string) => void) | undefined;
	const state = createState({
		renderMarkdownFinal: () =>
			new Promise<string>((resolve) => (resolveEnhancement = resolve)),
	});
	const controller = new AbortController();
	try {
		const response = state.createStream(controller.signal);
		state.replaceMessages([markdownMessage("lightweight source")]);
		while (!resolveEnhancement) await Promise.resolve();
		resolveEnhancement("<p>large finalized HTML</p>");
		await waitFor(() => projectedMessages(state)[0].presentationState === "final");
		state.setUsage({ text: "$1.000 • 1 token", costText: "$1.000" });
		const patches = await collectElementPatches(response, 4);

		assertIncludes(patches.patches[2], "large finalized HTML");
		assertIncludes(patches.patches[2], "data-ignore-morph");
		assertNotIncludes(patches.patches[3], "large finalized HTML");
		assertNotIncludes(patches.patches[3], "lightweight source");
		assertNotIncludes(patches.patches[3], 'id="messages"');
	} finally {
		controller.abort();
	}
});

Deno.test("ordinary commits exclude finalized tool messages", async () => {
	const state = createState({
		renderDiff: () =>
			Promise.resolve('<div data-pierre-diff="">highlighted edit</div>'),
	});
	const controller = new AbortController();
	try {
		const response = state.createStream(controller.signal);
		state.replaceMessages([
			{
				role: "tool",
				text: "@@ -1 +1 @@\n-old\n+new",
				timestamp,
				format: "diff",
			},
		]);
		await waitFor(() => projectedMessages(state)[0].presentationState === "final");
		state.setUsage({ text: "$1.000 • 1 token", costText: "$1.000" });
		const patches = await collectElementPatches(response, 4);

		assertIncludes(patches.patches[2], "highlighted edit");
		assertNotIncludes(patches.patches[3], "highlighted edit");
		assertNotIncludes(patches.patches[3], 'id="messages"');
	} finally {
		controller.abort();
	}
});

Deno.test("new messages append to the stable message list", async () => {
	const state = createState();
	const controller = new AbortController();
	try {
		const reader = await openInitializedStateStream(state, controller.signal);
		state.appendMessage("user", "first");
		const first = await readUntil(reader, (text) => text.includes("first"));
		assertIncludes(first, "data: selector #messages");

		state.appendMessage("tool", "one", { format: "output", state: "running" });
		state.appendMessage("tool", "two", { format: "output", state: "running" });
		const tools = await readUntil(
			reader,
			(text) => text.includes("one") && text.includes("two"),
		);
		assertEqual(count(tools, "data: selector #message-list"), 2);
		assertEqual(count(tools, "data: mode append"), 2);
		assertNotIncludes(tools, '<main id="messages"');
	} finally {
		controller.abort();
	}
});

Deno.test("parallel message updates all reach their final state", async () => {
	const state = createState();
	const controller = new AbortController();
	try {
		const reader = await openInitializedStateStream(state, controller.signal);
		state.appendMessage("user", "first");
		await readUntil(reader, (text) => text.includes("first"));
		const firstId = state.appendMessage("tool", "", {
			title: "read",
			format: "pre",
			state: "running",
		});
		const secondId = state.appendMessage("tool", "", {
			title: "read",
			format: "pre",
			state: "running",
		});
		await readUntil(reader, (text) => count(text, "data: mode append") === 2);

		state.updateMessage(firstId, { title: "read first.ts", state: "success" });
		state.updateMessage(secondId, { title: "read second.ts", state: "success" });
		const updates = await readUntil(
			reader,
			(text) => text.includes("read first.ts") && text.includes("read second.ts"),
		);

		assertEqual(count(updates, "data: selector [data-message-id="), 2);
		assertEqual(count(updates, "pi-tool-status-success"), 2);
	} finally {
		controller.abort();
	}
});

Deno.test("session transitions patch signals and replace only the transcript", async () => {
	const state = createState();
	const controller = new AbortController();
	try {
		const reader = await openInitializedStateStream(state, controller.signal);

		state.setSessionTransition({
			status: "loading",
			generation: 1,
			targetPath: "/session.jsonl",
			overlay: true,
		});
		const loading = await readUntil(reader, (text) =>
			text.includes('"_sessionTransitionLoading":true'),
		);
		assertNotIncludes(loading, "datastar-patch-elements");

		state.replaceMessages([{ role: "user", text: "restored transcript", timestamp }]);
		state.flush();
		const restored = await readUntil(reader, (text) =>
			text.includes("restored transcript"),
		);
		assertIncludes(restored, 'id="messages"');
		assertIncludes(restored, "data: selector #messages");
		assertIncludes(restored, "data: mode replace");
		assertNotIncludes(restored, 'id="session-sidebar-content"');

		state.setSessionTransition({ status: "idle", generation: 1 });
		const idle = await readUntil(reader, (text) =>
			text.includes('"_sessionTransitionLoading":false'),
		);
		assertNotIncludes(idle, "datastar-patch-elements");
	} finally {
		controller.abort();
	}
});

Deno.test("session loading clears after fallback and before enhancement", async () => {
	let resolveEnhancement: ((html: string) => void) | undefined;
	const state = createState({
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
			overlay: true,
		});
		state.replaceMessages([markdownMessage("content ready")]);
		state.setSessionTransition({ status: "idle", generation: 1 });
		const beforeEnhancement = await readUntil(reader, (text) => {
			const loading = text.indexOf('"_sessionTransitionLoading":true');
			const fallback = text.indexOf("content ready", loading);
			return (
				loading >= 0 &&
				fallback > loading &&
				text.indexOf('"_sessionTransitionLoading":false', fallback) > fallback
			);
		});
		const loading = beforeEnhancement.indexOf('"_sessionTransitionLoading":true');
		const fallback = beforeEnhancement.indexOf("content ready", loading);
		const idle = beforeEnhancement.indexOf(
			'"_sessionTransitionLoading":false',
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
	const state = createState({
		renderMarkdownFinal: (text) => {
			renderCount += 1;
			return Promise.resolve(`<p>${text}</p>`);
		},
	});
	state.replaceMessages(
		Array.from({ length: 80 }, (_, index) => markdownMessage(`**message ${index}**`)),
	);
	await waitFor(() => renderCount === 50);
	const ids = state.loadOlderMessages();
	assertEqual(ids.length, 30);
	state.renderer.patchOlderMessages(ids);
	await waitFor(() => renderCount === 80);
	assertEqual(state.loadOlderMessages(), []);
	const immediatePage = state.renderer.renderMessagesElement();
	assertIncludes(immediatePage, "<strong>message 0</strong>");
	assertNotIncludes(immediatePage, "**message 0**");
	assertEqual(renderCount, 80);
});

Deno.test("older messages use one targeted patch before restoring the anchor", async () => {
	const state = createState();
	state.replaceMessages(
		Array.from({ length: 130 }, (_, index) => ({
			role: "user" as const,
			text: `message ${index}`,
			timestamp,
		})),
	);
	const controller = new AbortController();
	try {
		const reader = await openInitializedStateStream(state, controller.signal);

		const ids = state.loadOlderMessages();
		assertEqual(ids.length, 50);
		state.renderer.patchOlderMessages(ids);
		const output = await readUntil(reader, (text) =>
			text.includes("window.piUi.messageScroll.restoreAnchor()"),
		);

		assertIncludes(output, "data: selector #older-messages-trigger");
		assertIncludes(output, "data: mode replace");
		assertIncludes(output, 'id="older-messages-trigger"');
		assertIncludes(output, "message 30");
		assertNotIncludes(output, "message 29");
		assertNotIncludes(output, 'id="messages"');
		assertIncludes(output, "window.piUi.messageScroll.restoreAnchor()");
	} finally {
		controller.abort();
	}
});

Deno.test("replacement discards stale enhancement completion", async () => {
	const gates: Array<{ text: string; resolve: (html: string) => void }> = [];
	const state = createState({
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
	assertEqual(projectedMessages(state)[0].renderedHtml, "<p>final B</p>");
	assertEqual(projectedMessages(state)[0].presentationState, "final");
});

Deno.test("oversized enhancement retains fallback until explicitly requested", async () => {
	let renderCount = 0;
	const state = createState({
		renderMarkdownFinal: (text) => {
			renderCount += 1;
			return Promise.resolve(`<p>${text.length}</p>`);
		},
	});
	state.replaceMessages([markdownMessage("large fallback ".repeat(2_000))]);
	await settleMicrotasks();
	assertEqual(renderCount, 0);
	assertEqual(projectedMessages(state)[0].presentationState, "deferred");
	assertIncludes(state.renderer.renderMessagesElement(), "Enhance formatting");
	assertEqual(state.renderer.enhanceMessage(state.messages[0].id), true);
	await waitFor(() => renderCount === 1);
	await settleMicrotasks();
	assertEqual(projectedMessages(state)[0].presentationState, "final");
});

Deno.test("skill and compaction instructions render Markdown without enhancement work", async () => {
	let renderCount = 0;
	const state = createState({
		renderMarkdownFinal: () => {
			renderCount += 1;
			return Promise.resolve("<p>enhanced</p>");
		},
	});
	state.replaceMessages([
		{ role: "skill", text: "**Skill instructions**", timestamp },
		{ role: "compaction", text: "**Compaction summary**", timestamp },
	]);
	await settleMicrotasks();

	assertEqual(renderCount, 0);
	assertIncludes(projectedMessages(state)[0].renderedHtml ?? "", "<strong>");
	assertIncludes(projectedMessages(state)[1].renderedHtml ?? "", "<strong>");
	assertEqual(state.renderer.enhanceMessage(state.messages[0].id), false);
	assertEqual(state.renderer.enhanceMessage(state.messages[1].id), false);
	assertNotIncludes(state.renderer.renderMessagesElement(), "Enhance formatting");
});

Deno.test("assistant completion immediately flushes newest streaming content", () => {
	const state = createState();
	state.appendMessage("assistant", "first");
	state.appendAssistantDelta(" **latest**");
	state.finishAssistant();
	assertIncludes(
		projectedMessages(state)[0].renderedHtml ?? "",
		"<strong>latest</strong>",
	);
});

Deno.test("running background transcript stays headless until activation", async () => {
	let enhancementCount = 0;
	const background = new TranscriptState({ keys: "N", description: "New" });
	background.appendAssistantDelta("```ts\nconst partial = true");
	background.appendMessage("tool", "still running", {
		state: "running",
		format: "code",
	});
	background.setQueuedMessages(["steer"], ["follow"]);
	await settleMicrotasks();
	assertEqual(enhancementCount, 0);

	const foreground = createState({
		renderMarkdownFinal: (text) => {
			enhancementCount += 1;
			return Promise.resolve(`<p>${text}</p>`);
		},
		renderCode: (text) => {
			enhancementCount += 1;
			return Promise.resolve(`<pre>${text}</pre>`);
		},
	});
	foreground.restoreChat(background.snapshot());
	await settleMicrotasks();

	assertEqual(enhancementCount, 1);
	assertEqual(projectedMessages(foreground)[0].presentationState, "streaming");
	assertIncludes(projectedMessages(foreground)[0].renderedHtml ?? "", "partial");
	assertEqual(foreground.messages[1].state, "running");
	assertEqual(foreground.queuedSteeringMessages.join(","), "steer");
	assertEqual(foreground.queuedFollowUpMessages.join(","), "follow");
});

Deno.test("AppStore transcript metadata has one owner and restores with chat", () => {
	const state = createState();
	state.setActivityText("Working...");
	state.setQueuedMessages(["steer"], ["follow"]);
	const snapshot = state.snapshotChat();

	state.setActivityText(undefined);
	state.setQueuedMessages([], []);
	state.restoreChat(snapshot);

	assertEqual(state.activityText, "Working...");
	assertEqual(state.queuedSteeringMessages.join(","), "steer");
	assertEqual(state.queuedFollowUpMessages.join(","), "follow");
	// SAFETY: The test deliberately attempts to mutate the runtime copy behind its readonly API.
	const steering = state.queuedSteeringMessages as string[];
	steering.push("external mutation");
	assertEqual(state.queuedSteeringMessages.join(","), "steer");
});

Deno.test("completed background transcript enhances only after activation", async () => {
	let enhancementCount = 0;
	const background = new TranscriptState({ keys: "N", description: "New" });
	background.appendAssistantDelta("completed **answer**");
	background.finishAssistant();
	await settleMicrotasks();
	assertEqual(enhancementCount, 0);

	const foreground = createState({
		renderMarkdownFinal: () => {
			enhancementCount += 1;
			return Promise.resolve("<p>enhanced</p>");
		},
	});
	foreground.restoreChat(background.snapshot());
	await waitFor(() => projectedMessages(foreground)[0]?.presentationState === "final");
	assertEqual(enhancementCount, 1);
});

Deno.test("enhancement errors retain the rendered Markdown fallback", async () => {
	const originalWarn = console.warn;
	console.warn = () => {};
	try {
		const state = createState({
			renderMarkdownFinal: () => Promise.reject(new Error("render failed")),
		});
		state.replaceMessages([markdownMessage("<b>**fallback**</b>")]);
		await settleMicrotasks();
		assertEqual(
			projectedMessages(state)[0].renderedHtml,
			"<p><strong>fallback</strong></p>\n",
		);
		assertEqual(projectedMessages(state)[0].presentationState, "plain");
		assertIncludes(
			state.renderer.renderMessagesElement(),
			"<p><strong>fallback</strong></p>",
		);
	} finally {
		console.warn = originalWarn;
	}
});

Deno.test("nested state updates commit one fat morph and one signal patch", async () => {
	const state = createState();
	const controller = new AbortController();
	try {
		const reader = await openInitializedStateStream(state, controller.signal);
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
		assertIncludes(output, '"_isBusy":true');
		assertNotIncludes(output, '"thinkingLevel"');
		assertNotIncludes(output, '"model"');
	} finally {
		controller.abort();
	}
});

Deno.test("a thrown update still commits its completed mutations", async () => {
	const state = createState();
	const controller = new AbortController();
	try {
		const reader = await openInitializedStateStream(state, controller.signal);
		try {
			state.update(() => {
				state.workspacePath = "/tmp/committed-before-throw";
				throw new Error("stop");
			});
		} catch {
			// The mutator error is expected; already-applied state remains authoritative.
		}
		const output = await readUntil(
			reader,
			(text) =>
				text.includes("event: datastar-patch-elements") &&
				text.includes("event: datastar-patch-signals"),
		);
		assertEqual(count(output, "event: datastar-patch-elements"), 1);
		assertEqual(count(output, "event: datastar-patch-signals"), 1);
	} finally {
		controller.abort();
	}
});

Deno.test("headless updates initialize one current view and tolerate disconnect", async () => {
	const state = createState();
	state.setWorkspacePath("/tmp/headless");
	const controller = new AbortController();
	const response = state.createStream(controller.signal);
	const reader = response.body?.getReader();
	if (!reader) throw new Error("Missing response body");
	const output = await readUntil(
		reader,
		(text) =>
			text.includes("event: datastar-patch-elements") &&
			text.includes("event: datastar-patch-signals"),
	);
	assertEqual(count(output, "event: datastar-patch-elements"), 1);
	assertEqual(count(output, "event: datastar-patch-signals"), 1);

	controller.abort();
	state.setActivityText("disconnected");
	state.flush();
	assertEqual(state.activityText, "disconnected");
});

Deno.test("session pagination patches only session-owned regions", async () => {
	const state = createState();
	const sessions = Array.from({ length: 70 }, (_, index) => ({
		path: `/sessions/${index}.jsonl`,
		cwd: "/workspace",
		title: `Session ${index}`,
		subtitle: `${index} messages`,
		modified: "now",
	}));
	state.setSessionCatalog(sessions);
	state.setSessionCatalogLoading(false);
	state.loadMoreSessions();
	state.flush();
	assertEqual(state.snapshot().sessionSidebarSessions.length, 60);
	assertEqual(state.snapshot().sessionSidebarHasMore, true);

	const controller = new AbortController();
	try {
		const reader = await openInitializedStateStream(state, controller.signal);
		state.setUsage({ text: "$2.000 • 2 tokens", costText: "$2.000" });
		state.flush();
		const unrelated = await readUntil(reader, (text) => text.includes("$2.000"));
		assertNotIncludes(unrelated, 'id="session-sidebar-content"');

		state.updateSessionSummary(sessions[0].path, (session) => ({
			...session,
			title: "Updated active session",
		}));
		state.flush();
		const updated = await readUntil(reader, (text) =>
			text.includes("Updated active session"),
		);
		assertIncludes(updated, 'id="session-sidebar-content"');

		state.loadMoreSessions();
		state.flush();
		const complete = await readUntil(reader, (text) => text.includes("Session 69"));
		assertNotIncludes(complete, "@post('/sessions/more'");
		assertEqual(state.snapshot().sessionSidebarHasMore, false);
	} finally {
		controller.abort();
	}
});

Deno.test("workspace review snapshots travel through the app stream", async () => {
	const state = createState();
	state.setWorkspaceReview({
		branch: "main",
		changes: [],
		commits: [],
		isGitRepository: true,
		patch: "",
		revision: "review-1",
	});
	state.flush();
	const controller = new AbortController();
	try {
		const response = state.createStream(controller.signal);
		const reader = response.body?.getReader();
		if (!reader) throw new Error("Missing response body");
		const output = await readUntil(
			reader,
			(text) => text.includes("workspace-review-data") && text.includes("review-1"),
		);
		assertIncludes(output, '"branch":"main"');
	} finally {
		controller.abort();
	}
});

Deno.test("initial streams reopen active backend dialogs", async () => {
	const state = createState();
	state.setAuthDialog({
		mode: "login",
		phase: "providers",
		providers: [],
		progress: [],
	});
	state.flush();
	const controller = new AbortController();
	try {
		const response = state.createStream(controller.signal);
		const reader = response.body?.getReader();
		if (!reader) throw new Error("Missing response body");
		const output = await readUntil(
			reader,
			(text) => text.includes("auth-dialog") && text.includes("showModal"),
		);
		assertIncludes(output, "if (dialog && !dialog.open) dialog.showModal()");
	} finally {
		controller.abort();
	}
});

Deno.test("component morphs need no server refresh script", async () => {
	const state = createState();
	const controller = new AbortController();
	try {
		const reader = await openInitializedStateStream(state, controller.signal);
		state.update(
			() => {
				state.setThinking("high", ["off", "high"]);
				state.setCurrentModel("provider/model");
			},
			{ flush: true },
		);
		const output = await readUntil(reader, (text) =>
			text.includes("event: datastar-patch-signals"),
		);
		assertEqual(count(output, '<script data-effect="el.remove()">'), 0);
	} finally {
		controller.abort();
	}
});

Deno.test("app stream refreshes current and background session statuses", async () => {
	const state = createState();
	const controller = new AbortController();
	const first = {
		path: "/sessions/first.jsonl",
		cwd: "/workspace",
		title: "First session",
		subtitle: "First subtitle",
		modified: "now",
	};
	const second = {
		path: "/sessions/second.jsonl",
		cwd: "/workspace",
		title: "Second session",
		subtitle: "Second subtitle",
		modified: "earlier",
	};
	try {
		const response = state.renderer.createStream(controller.signal);
		const reader = response.body?.getReader();
		if (!reader) throw new Error("Missing response body");
		await readUntil(reader, (text) => text.includes("event: datastar-patch-signals"));

		state.update(
			() => {
				state.setCurrentSessionPath(first.path);
				state.setActivityText("Working...");
				state.setSessions([first, second]);
			},
			{ flush: true },
		);
		const running = await readUntil(reader, (text) =>
			text.includes('aria-label="Current session running"'),
		);
		assertIncludes(running, 'id="session-menu-content"');
		assertIncludes(running, 'aria-current="true"');
		assertIncludes(running, "First session");

		state.update(
			() => {
				state.setCurrentSessionPath(second.path);
				state.setActivityText(undefined);
				state.setSessions([{ ...first, backgroundStatus: "completed" }, second]);
			},
			{ flush: true },
		);
		const completed = await readUntil(reader, (text) =>
			text.includes('aria-label="Background session completed"'),
		);
		assertIncludes(completed, 'id="session-menu-content"');
		assertIncludes(completed, 'aria-current="true"');
		assertNotIncludes(
			completed.slice(completed.lastIndexOf('id="session-menu-content"')),
			'aria-label="Current session running"',
		);
	} finally {
		controller.abort();
	}
});

Deno.test("state snapshots contain domain messages only", () => {
	const state = createState();
	state.appendMessage("assistant", "**answer**");

	const message = state.snapshot().messages[0];
	assertEqual("renderedHtml" in message, false);
	assertEqual("presentationState" in message, false);
	assertEqual("presentationVersion" in message, false);
	assertIncludes(projectedMessages(state)[0].renderedHtml ?? "", "<strong>");
});

Deno.test("initial and live backend-owned signals share exact projections", () => {
	const state = createState();
	const cases = [
		() => {},
		() => state.setActivityText("Working..."),
		() =>
			state.setSessionTransition({
				status: "loading",
				generation: 1,
				targetPath: "/session.jsonl",
				overlay: true,
			}),
		() => {
			state.setCurrentModel("provider/model");
			state.setThinking("high", ["off", "high"]);
			state.setWorkspacePath("/tmp/workspace");
			state.setActivityText(undefined);
			state.setSessionTransition({ status: "idle", generation: 1 });
		},
	];
	for (const mutate of cases) {
		mutate();
		const snapshot = state.snapshot();
		assertEqual(
			state.renderer.renderSignals(snapshot),
			JSON.stringify(projectBackendSignals(snapshot)),
		);
	}
});

Deno.test("server-owned view signals are transport-private", () => {
	const signals = projectBackendSignals(createState().snapshot());
	assertEqual(Object.keys(signals).sort(), [
		"_codeThemeDark",
		"_codeThemeLight",
		"_fontMono",
		"_fontSans",
		"_isBusy",
		"_isSessionReady",
		"_promptHistory",
		"_sessionTransitionGeneration",
		"_sessionTransitionLoading",
		"_sessionTransitionStatus",
		"_sessionTransitionVisible",
		"_thinkingHidden",
		"_workspaceReviewAdditions",
		"_workspaceReviewBranch",
		"_workspaceReviewChangeCount",
		"_workspaceReviewDeletions",
		"_workspaceReviewGitAvailable",
		"_workspaceReviewHasChanges",
	]);
});

Deno.test("hot app views exclude independently owned regions", () => {
	const previous = Deno.env.get("PI_UI_DEBUG");
	Deno.env.set("PI_UI_DEBUG", "1");
	try {
		const store = new AppStore();
		const renderer = new UiRenderer(store, new DatastarClientHub());
		const snapshot = store.snapshot();
		const view = renderer.renderElements(renderer.projectState(snapshot));
		assertIncludes(view, 'id="debug-fps" data-ignore-morph');
		for (const id of [
			"messages",
			"prompt-action",
			"prompt-queue",
			"prompt-toolbar",
			"prompt-status",
			"workspace-picker",
			"session-transition",
			"debug-overlay",
		])
			assertIncludes(view, `id="${id}"`);
		for (const id of [
			"auth-dialog-content",
			"extension-dialog-content",
			"llama-dialog-content",
			"workspace-menu",
			"model-picker",
			"thinking-picker",
			"slash-picker",
			"tree-picker",
			"session-menu-content",
			"session-sidebar-content",
			"workspace-review-data",
		])
			assertNotIncludes(view, `id="${id}"`);
	} finally {
		if (previous === undefined) Deno.env.delete("PI_UI_DEBUG");
		else Deno.env.set("PI_UI_DEBUG", previous);
	}
});

Deno.test("fat morph markup preserves browser-owned interaction state", () => {
	const state = createState();
	state.setModels(
		[
			{
				id: "test-model",
				provider: "test-provider",
				name: "Test Model",
				configured: true,
				scoped: false,
			},
		],
		"test-provider/test-model",
	);
	state.replaceMessages([
		{
			role: "compaction",
			text: "summary",
			timestamp,
		},
	]);
	state.flush();
	const html = renderPage(state.renderer.projectState(state.snapshot()));

	assertIncludes(html, 'id="prompt-input"');
	assertNotIncludes(html, " data-native-file-picker ");
	const displayClientId = html.match(/\/stream\?clientId=([0-9a-f-]{36})/)?.[1];
	assert(displayClientId, "Display client ID is missing");
	assertIncludes(html, `clientId: '${displayClientId}'`);
	assertIncludes(html, "payload: {}");
	assertIncludes(html, "filterSignals");
	const globalSignals = html.match(/<body[^>]*data-signals="([^"]+)"/)?.[1] ?? "";
	assertIncludes(globalSignals, "_isBusy");
	assertNotIncludes(globalSignals, "&#34;prompt&#34;");
	assertNotIncludes(globalSignals, "workspacePath");
	assertNotIncludes(globalSignals, "thinkingLevel");
	assertNotIncludes(globalSignals, "&#34;model&#34;");
	assertIncludes(html, "data-signals:session-search__ifmissing");
	assertIncludes(html, "data-signals__ifmissing");
	for (const signal of [
		"prompt",
		"workspaceDraft",
		"authInput",
		"_fileSearchController",
	]) {
		assertIncludes(html, `&#34;${signal}&#34;:&#34;&#34;`);
	}
	assertIncludes(html, "$_fileSearchController.abort()");
	assertIncludes(html, "requestCancellation: $_fileSearchController");
	assertIncludes(html, 'id="messages"');
	assertIncludes(html, 'id="workspace-dialog"');
	assertIncludes(html, 'id="session-dialog"');
	assertIncludes(html, 'class="command sm:max-w-xl" data-filter="manual"');
	assertIncludes(html, 'id="session-sidebar"');
	assertIncludes(html, 'class="sidebar peer/sidebar group/sidebar"');
	assertIncludes(html, 'data-side="right"');
	const workspaceShell = html.match(/<div[^>]*id="workspace-shell"[^>]*>/)?.[0] ?? "";
	assertIncludes(workspaceShell, "@container/workspace");
	assertIncludes(workspaceShell, " grid ");
	assertIncludes(workspaceShell, "--pi-review-pane-ratio");
	assertNotIncludes(workspaceShell, "--pi-review-sidebar-width");
	assertNotIncludes(workspaceShell, "--pi-review-changes-ratio");
	const reviewBody = html.match(/<div[^>]*id="review-body"[^>]*>/)?.[0] ?? "";
	assertIncludes(reviewBody, "--pi-review-sidebar-width");
	const reviewSidebar =
		html.match(/<aside[^>]*id="review-git-sidebar"[^>]*>/)?.[0] ?? "";
	assertIncludes(reviewSidebar, "--pi-review-changes-ratio");
	assertIncludes(html, 'id="model-select"');
	assert(
		html.indexOf("/app/main.js") < html.indexOf("/vendor/datastar.js"),
		"window.piUi must initialize before Datastar",
	);
	const app = html.match(/<div[^>]*id="app"[^>]*>/)?.[0] ?? "";
	assertIncludes(app, 'data-class:pi-review-open="$_workspaceReviewOpen"');
	assertIncludes(app, "window.piUi.workspaceReview.applyOpen($_workspaceReviewOpen)");
	assertIncludes(app, "openWhenHidden: true");
	const review = html.match(/<section[^>]*id="workspace-review"[^>]*>/)?.[0] ?? "";
	assertIncludes(review, 'data-attr:aria-hidden="$_workspaceReviewOpen');
	assertIncludes(review, 'data-attr:inert="!$_workspaceReviewOpen"');
	const treeDialog = html.match(/<dialog[^>]*id="tree-dialog"[^>]*>/)?.[0] ?? "";
	assertIncludes(treeDialog, 'data-preserve-attr="open"');
});

type TestStore = AppStore & {
	readonly renderer: UiRenderer;
	createStream(signal: AbortSignal): Response;
};

function createState(options: MessageRenderServiceOptions = {}): TestStore {
	const store = new AppStore();
	const renderer = new UiRenderer(store, new DatastarClientHub(), options);
	return Object.assign(store, {
		renderer,
		createStream: (signal: AbortSignal) => renderer.createStream(signal),
	});
}

function projectedMessages(state: TestStore) {
	return state.renderer.projectState(state.snapshot()).messages;
}

function markdownMessage(text: string): AppMessageInput {
	return { role: "assistant", text, timestamp };
}

async function settleMicrotasks(): Promise<void> {
	for (let index = 0; index < 8; index += 1) await Promise.resolve();
}

async function waitFor(complete: () => boolean): Promise<void> {
	for (let index = 0; index < 500; index += 1) {
		if (complete()) return;
		await Promise.resolve();
	}
	throw new Error("Expected asynchronous work did not complete");
}

async function openInitializedStateStream(
	state: TestStore,
	signal: AbortSignal,
): Promise<ReadableStreamDefaultReader<Uint8Array>> {
	const reader = state.createStream(signal).body?.getReader();
	if (!reader) throw new Error("Missing response body");
	await readUntil(reader, (text) => text.includes("event: datastar-patch-signals"));
	return reader;
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

function count(value: string, search: string): number {
	return value.split(search).length - 1;
}
