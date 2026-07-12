import { assertEquals, assertStringIncludes } from "@std/assert";

import type { AgentHost } from "../../agent/host.ts";
import { AppStore } from "../../state/app-store.ts";
import type { UiRenderer } from "../../ui/ui-renderer.ts";
import { createRouter } from "../app.ts";
import { FileSearchHost } from "../file-search.ts";
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
		"POST /sessions/list",
		"POST /sessions/background/abort",
		"POST /sessions/delete",
		"POST /sessions/resume",
		"POST /workspace/open",
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
		"POST /files/import",
		"GET /basecoat.js",
		"GET /vendor/datastar-inspector.min.js",
	].sort();
	assertEquals([...router.registeredRoutes()].sort(), expected);
	assertEquals(Object.values(endpoints).length, expected.length);
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
		assertStringIncludes(await response.text(), "piUiOpenTreeDialog");
	}
	assertEquals(opens, 2);
});

Deno.test("tree navigation is single-flight and can be cancelled by reopening", async () => {
	let resolveNavigation: (value: string | undefined) => void = () => {};
	let markStarted: () => void = () => {};
	const navigation = new Promise<string | undefined>(
		(resolve) => (resolveNavigation = resolve),
	);
	const started = new Promise<void>((resolve) => (markStarted = resolve));
	let opens = 0;
	const host = fakeHost({
		navigateTree: () => {
			markStarted();
			return navigation;
		},
		openTree: () => ((opens += 1), true),
	});
	const router = createRouter(fakeContext({ host }));
	const first = router.fetch(
		signalRequest("/tree/navigate", {
			treeEntryId: "entry",
			treeSummarize: true,
			treeSummaryInstructions: "",
		}),
	);
	await started;
	assertEquals(
		(
			await router.fetch(
				signalRequest("/tree/navigate", {
					treeEntryId: "other",
					treeSummarize: false,
					treeSummaryInstructions: "",
				}),
			)
		).status,
		409,
	);
	assertEquals((await router.fetch(signalRequest("/tree/open", {}))).status, 200);
	assertEquals(opens, 1);
	resolveNavigation(undefined);
	assertEquals((await first).status, 200);
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
		resources: {
			host: overrides.host ?? fakeHost(),
			fileSearch: FileSearchHost.create(Deno.cwd()),
		},
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
		navigateTree: async () => "",
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

function signalRequest(path: string, signals: Record<string, unknown>): Request {
	return new Request(`http://localhost${path}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(signals),
	});
}
