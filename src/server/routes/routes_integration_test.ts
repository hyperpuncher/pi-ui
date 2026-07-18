import { assertEquals, assertStringIncludes } from "@std/assert";

import type { AgentHost } from "../../agent/host.ts";
import { AppStore } from "../../state/app-store.ts";
import type { UiRenderer } from "../../ui/ui-renderer.ts";
import { createRouter } from "../app.ts";
import type { RouteContext } from "./context.ts";
import { endpoints } from "./endpoints.ts";

Deno.test("all server endpoints are registered through domain route modules", async () => {
	const context = fakeContext();
	const router = createRouter(context);
	const expected = [
		"GET /",
		"GET /stream",
		"POST /display-refresh",
		"POST /prompt",
		"POST /prompt/follow-up",
		"POST /prompt/dequeue",
		"POST /abort",
		"POST /messages/older",
		"POST /messages/enhance",
		"POST /sessions/new",
		"POST /sessions/new-temporary",
		"GET /sessions/stream",
		"POST /sessions/background/abort",
		"POST /sessions/delete",
		"POST /sessions/resume",
		"POST /workspace/open",
		"GET /workspace/review",
		"POST /model",
		"POST /model/cycle",
		"POST /models/scope/toggle",
		"POST /thinking",
		"POST /thinking/cycle",
		"POST /auth/open-login",
		"POST /auth/open-logout",
		"POST /auth/login/start",
		"POST /auth/input",
		"POST /auth/logout",
		"POST /auth/close",
		"POST /tree/open",
		"POST /tree/navigate",
		"GET /files/search",
		"POST /files/pick",
		"POST /files/import",
		"GET /basecoat.js",
		"GET /vendor/datastar-inspector.min.js",
	].sort();
	assertEquals([...router.registeredRoutes()].sort(), expected);
	assertEquals(Object.values(endpoints).length, expected.length);
});

Deno.test("file search uses current workspace and escapes Datastar fragments", async () => {
	const firstWorkspace = await Deno.makeTempDir();
	const secondWorkspace = await Deno.makeTempDir();
	try {
		await Deno.writeTextFile(`${firstWorkspace}/first.txt`, "");
		await Deno.writeTextFile(`${secondWorkspace}/<unsafe>.txt`, "");
		const context = fakeContext();
		context.store.setWorkspacePath(firstWorkspace);
		const router = createRouter(context);
		const first = await router.fetch(
			signalGet("/files/search", { fileQuery: "first" }),
		);
		assertStringIncludes(await first.text(), "first.txt");

		context.store.setWorkspacePath(secondWorkspace);
		const response = await router.fetch(
			signalGet("/files/search", { fileQuery: "unsafe" }),
		);
		assertEquals(response.status, 200);
		assertEquals(response.headers.get("content-type"), "text/event-stream");
		const body = await response.text();
		assertStringIncludes(body, 'id="file-picker-results"');
		assertStringIncludes(body, "&lt;unsafe>.txt");
		assertStringIncludes(body, "datastar-patch-elements");
		assertEquals((await router.fetch(signalGet("/files/search", {}))).status, 400);
		assertEquals(
			(
				await router.fetch(
					new Request("http://localhost/files/search?datastar=%7B"),
				)
			).status,
			400,
		);
	} finally {
		await Promise.all([
			Deno.remove(firstWorkspace, { recursive: true }),
			Deno.remove(secondWorkspace, { recursive: true }),
		]);
	}
});

Deno.test("workspace review streams isolated snapshot events", async () => {
	const workspace = await Deno.makeTempDir();
	const abort = new AbortController();
	try {
		const context = fakeContext();
		context.store.setWorkspacePath(workspace);
		const response = await createRouter(context).fetch(
			new Request("http://localhost/workspace/review", { signal: abort.signal }),
		);
		assertEquals(response.status, 200);
		assertEquals(response.headers.get("content-type"), "text/event-stream");
		const chunk = await response.body?.getReader().read();
		const event = new TextDecoder().decode(chunk?.value);
		assertStringIncludes(event, "data: ");
		assertStringIncludes(event, '"isGitRepository":false');
	} finally {
		abort.abort();
		await Deno.remove(workspace, { recursive: true });
	}
});

Deno.test("malformed actions return 400 without mutating the transcript", async () => {
	const context = fakeContext();
	const response = await createRouter(context).fetch(
		new Request("http://localhost/prompt", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: "{",
		}),
	);
	assertEquals(response.status, 400);
	assertEquals(context.store.messages.length, 0);
});

Deno.test("host-dependent actions return 503 when runtime is absent", async () => {
	const context = fakeContext();
	context.resources.host = undefined;
	const response = await createRouter(context).fetch(
		signalRequest("/prompt", { prompt: "hello" }),
	);
	assertEquals(response.status, 503);
});

Deno.test("accepted prompts do not clear a newer frontend draft", async () => {
	const router = createRouter(fakeContext());
	for (const path of ["/prompt", "/prompt/follow-up"]) {
		const response = await router.fetch(signalRequest(path, { prompt: "hello" }));
		assertEquals(response.status, 204);
		assertEquals(await response.text(), "");
	}
});

Deno.test("display refresh updates presentation owner directly", async () => {
	let measured = 0;
	const context = fakeContext({
		renderer: {
			setDisplayRefreshHz: (hz: number) => ((measured = hz), true),
		} as UiRenderer,
	});
	const router = createRouter(context);
	const response = await router.fetch(
		new Request("http://localhost/display-refresh", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ hz: 120 }),
		}),
	);
	assertEquals(response.status, 204);
	assertEquals(measured, 120);
	assertEquals(
		(
			await router.fetch(
				new Request("http://localhost/display-refresh", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ hz: 1 }),
				}),
			)
		).status,
		400,
	);
});

Deno.test("tree open remains repeatable and includes the fallback open effect", async () => {
	let opens = 0;
	const host = fakeHost({ openTree: () => ((opens += 1), true) });
	const router = createRouter(fakeContext({ host }));
	for (let index = 0; index < 2; index += 1) {
		const response = await router.fetch(signalRequest("/tree/open", {}));
		assertEquals(response.status, 200);
		assertStringIncludes(await response.text(), "piUi.dialogs.openTree");
	}
	assertEquals(opens, 2);
});

Deno.test("tree navigation state follows mutable host ownership", async () => {
	let resolveNavigation: (value: {
		status: "success";
		editorText: string;
	}) => void = () => {};
	let markStarted: () => void = () => {};
	const navigation = new Promise<{ status: "success"; editorText: string }>(
		(resolve) => (resolveNavigation = resolve),
	);
	const started = new Promise<void>((resolve) => (markStarted = resolve));
	const oldHost = fakeHost({
		navigateTree: (entryId: string) => {
			if (entryId !== "entry") return Promise.resolve({ status: "busy" });
			markStarted();
			return navigation;
		},
	});
	const context = fakeContext({ host: oldHost });
	const router = createRouter(context);
	const first = router.fetch(treeNavigateRequest("entry"));
	await started;
	assertEquals((await router.fetch(treeNavigateRequest("other"))).status, 409);

	context.resources.host = fakeHost({
		navigateTree: async () => ({ status: "success", editorText: "replacement" }),
	});
	const replacement = await router.fetch(treeNavigateRequest("new"));
	assertEquals(replacement.status, 200);
	assertStringIncludes(await replacement.text(), "replacement");

	resolveNavigation({ status: "success", editorText: "stale" });
	const cancelled = await first;
	assertEquals(cancelled.status, 204);
	const cancelledBody = await cancelled.text();
	assertEquals(cancelledBody.includes('"prompt"'), false);
});

function fakeContext(
	overrides: { host?: AgentHost; renderer?: UiRenderer } = {},
): RouteContext {
	const store = new AppStore();
	return {
		store,
		renderer:
			overrides.renderer ??
			({
				createStream: () => new Response(),
				renderMessagesElement: () => "<div id=messages></div>",
				enhanceMessage: () => true,
				setDisplayRefreshHz: () => true,
			} as unknown as UiRenderer),
		resources: { host: overrides.host ?? fakeHost() },
		transferredFiles: { importFiles: async () => [] } as never,
		openWorkspace: async () => true,
		readBasecoat: async () => new ArrayBuffer(0),
		serveStatic: async () => new Response("static"),
	};
}

function fakeHost(overrides: Record<string, unknown> = {}): AgentHost {
	return {
		abort: async () => {},
		abortBackgroundSession: async () => true,
		closeAuth: () => {},
		cycleModel: async () => true,
		cycleThinkingLevel: () => true,
		deleteSession: async () => true,
		getWorkspacePath: () => Deno.cwd(),
		listSessions: async () => {},
		logout: () => true,
		navigateTree: async () => ({ status: "success", editorText: "" }),
		newSession: async () => ({ status: "success" }),
		newTemporarySession: async () => ({ status: "success" }),
		openLogin: () => {},
		openLogout: () => {},
		openTree: () => true,
		prompt: async () => true,
		restoreQueuedMessages: () => "",
		resumeSession: async () => ({ status: "success" }),
		setModel: async () => true,
		setThinkingLevel: async () => true,
		startLogin: () => true,
		submitAuthInput: () => true,
		toggleScopedModel: async () => true,
		...overrides,
	} as unknown as AgentHost;
}

function treeNavigateRequest(entryId: string): Request {
	return signalRequest("/tree/navigate", {
		treeEntryId: entryId,
		treeSummarize: false,
		treeSummaryInstructions: "",
	});
}

function signalGet(path: string, signals: Record<string, unknown>): Request {
	const datastar = encodeURIComponent(JSON.stringify(signals));
	return new Request(`http://localhost${path}?datastar=${datastar}`);
}

function signalRequest(path: string, signals: Record<string, unknown>): Request {
	return new Request(`http://localhost${path}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(signals),
	});
}
