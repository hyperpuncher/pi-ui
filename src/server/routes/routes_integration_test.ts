import type { Jsonifiable } from "@starfederation/datastar-sdk/types";
import { assertEquals, assertStringIncludes } from "@std/assert";
import { toFileUrl } from "@std/path";

import { AgentHost } from "../../agent/host.ts";
import { AppStore } from "../../state/app-store.ts";
import { assertStringExcludes } from "../../testing/assertions.ts";
import { UiRenderer } from "../../ui/ui-renderer.ts";
import { createRouter, isLoopbackAddress } from "../app.ts";
import { DatastarClientHub } from "../datastar-client-hub.ts";
import { SessionImageStore } from "../session-image-store.ts";
import type { RouteContext } from "./context.ts";
import { endpoints } from "./endpoints.ts";
import { pickWorkspace } from "./workspace.ts";

Deno.test("all server endpoints are registered through domain route modules", async () => {
	const context = fakeContext();
	const router = createRouter(context);
	const expected = [
		"GET /",
		"GET /stream",
		"POST /display-refresh",
		"POST /code-theme",
		"POST /fonts",
		"POST /keybind-hints",
		"POST /minimal-mode",
		"POST /tool-output",
		"POST /session-performance/client",
		"POST /prompt",
		"POST /prompt/follow-up",
		"POST /prompt/dequeue",
		"POST /prompt/queue/remove",
		"POST /abort",
		"POST /messages/older",
		"POST /messages/enhance",
		"POST /sessions/new",
		"POST /sessions/new-temporary",
		"GET /sessions/search",
		"POST /sessions/more",
		"GET /sessions/favicon",
		"GET /sessions/image",
		"POST /sessions/background/abort",
		"POST /sessions/delete",
		"POST /sessions/rename",
		"POST /sessions/resume",
		"POST /workspace/open",
		"POST /workspace/pick",
		"GET /workspace/search",
		"GET /workspace/files",
		"GET /workspace/files/content",
		"PUT /workspace/files/content",
		"POST /workspace/files/entry",
		"PATCH /workspace/files/entry",
		"DELETE /workspace/files/entry",
		"GET /workspace/review/commit",
		"POST /workspace/review/discard",
		"GET /workspace/review/history",
		"POST /workspace/review/preferences",
		"POST /workspace/review/submit",
		"POST /model",
		"POST /model/cycle",
		"POST /models/scope/toggle",
		"POST /thinking",
		"POST /thinking/cycle",
		"POST /thinking/visibility/toggle",
		"POST /auth/open-login",
		"POST /auth/open-logout",
		"POST /auth/login/start",
		"POST /auth/input",
		"POST /auth/logout",
		"POST /auth/close",
		"POST /llama/open",
		"POST /llama/toggle",
		"POST /llama/close",
		"POST /extensions/ui/editor",
		"POST /extensions/ui/respond",
		"POST /tree/open",
		"POST /tree/navigate",
		"GET /files/search",
		"POST /files/pick",
		"POST /files/import",
		"POST /files/open",
		"GET /basecoat.js",
		"GET /vendor/datastar-inspector.min.js",
	].sort();
	assertEquals([...router.registeredRoutes()].sort(), expected);
	assertEquals(
		new Set(Object.values(endpoints)),
		new Set(expected.map((route) => route.slice(route.indexOf(" ") + 1))),
	);
});

Deno.test("page assets use the current immutable content version", async () => {
	const context = fakeContext();
	context.renderer = new UiRenderer(context.store, new DatastarClientHub());
	const response = await createRouter(context).fetch(new Request("http://localhost/"));
	const html = await response.text();
	assertEquals(response.headers.get("cache-control"), "no-store");
	assertStringIncludes(html, `/static/${context.appVersion}/app.css`);
	assertStringIncludes(html, `appVersion=${context.appVersion}`);
	assertStringIncludes(html, " data-keybind-hints ");
	assertStringExcludes(html, " data-minimal-mode ");
	assertStringIncludes(html, "KeyM");
	assertStringIncludes(html, "KeyO");
	assertStringIncludes(html, "/minimal-mode");
	assertStringIncludes(html, "/tool-output");
	assertStringIncludes(html, "$_toolOutputHidden");

	context.keybindHints = false;
	context.minimalMode = true;
	context.toolOutputHidden = true;
	const hiddenHintsPage = await createRouter(context).fetch(
		new Request("http://localhost/"),
	);
	const quietPageHtml = await hiddenHintsPage.text();
	assertStringExcludes(quietPageHtml, " data-keybind-hints ");
	assertStringIncludes(quietPageHtml, " data-minimal-mode ");

	const basecoat = await createRouter(context).fetch(
		new Request("http://localhost/basecoat.js"),
	);
	assertEquals(basecoat.headers.get("cache-control"), "no-cache, must-revalidate");
});

Deno.test("stale main streams reload the page before connecting", async () => {
	let connected = false;
	const context = fakeContext({
		renderer: uiRendererStub({
			createStream: () => {
				connected = true;
				return new Response("stream");
			},
		}),
	});
	const clientId = crypto.randomUUID();
	const router = createRouter(context);
	const stale = await router.fetch(
		new Request(`http://localhost/stream?clientId=${clientId}&appVersion=old`),
	);
	assertEquals(stale.headers.get("content-type"), "text/javascript; charset=utf-8");
	assertEquals(await stale.text(), "location.reload();");
	assertEquals(connected, false);

	const current = await router.fetch(
		new Request(
			`http://localhost/stream?clientId=${clientId}&appVersion=${context.appVersion}`,
		),
	);
	assertEquals(await current.text(), "stream");
	assertEquals(connected, true);
});

Deno.test("session favicons use workspace assets and fall back to a folder", async () => {
	const workspace = await Deno.makeTempDir();
	try {
		await Deno.mkdir(`${workspace}/public`);
		await Deno.writeFile(
			`${workspace}/public/favicon.png`,
			new Uint8Array([1, 2, 3]),
		);
		const context = fakeContext();
		context.store.setSessions([
			{
				path: "/sessions/one.jsonl",
				cwd: workspace,
				title: "One",
				subtitle: "1 message",
				modified: "Now",
			},
		]);
		const router = createRouter(context);

		const favicon = await router.fetch(
			new Request(
				`http://localhost/sessions/favicon?cwd=${encodeURIComponent(workspace)}`,
			),
		);
		assertEquals(favicon.headers.get("content-type"), "image/png");
		assertEquals(
			new Uint8Array(await favicon.arrayBuffer()),
			new Uint8Array([1, 2, 3]),
		);

		const fallback = await router.fetch(
			new Request("http://localhost/sessions/favicon?cwd=unknown"),
		);
		assertEquals(
			fallback.headers.get("content-type"),
			"image/svg+xml; charset=utf-8",
		);
		assertStringIncludes(await fallback.text(), "M20 20a2 2");
	} finally {
		await Deno.remove(workspace, { recursive: true });
	}
});

Deno.test("older messages use a targeted persistent-stream patch", async () => {
	let revealedIds: readonly string[] = [];
	const context = fakeContext({
		renderer: uiRendererStub({
			patchOlderMessages: (ids) => {
				revealedIds = ids;
			},
		}),
	});
	context.store.replaceMessages(
		Array.from({ length: 80 }, (_, index) => ({
			role: "user" as const,
			text: `message ${index}`,
			timestamp: new Date(0),
		})),
	);
	const response = await createRouter(context).fetch(
		new Request("http://localhost/messages/older", { method: "POST" }),
	);

	assertEquals(response.status, 204);
	assertEquals(await response.text(), "");
	assertEquals(revealedIds.length, 30);
});

Deno.test("older sessions expand backend-owned sidebar state", async () => {
	const context = fakeContext();
	context.store.setSessionCatalog(
		Array.from({ length: 51 }, (_, index) => ({
			path: `/sessions/${index + 1}.jsonl`,
			cwd: "/workspace",
			title: `Session ${index + 1}`,
			subtitle: "1 message",
			modified: "Today",
		})),
	);
	assertEquals(context.store.snapshot().sessionSidebarSessions.length, 30);

	const response = await createRouter(context).fetch(
		new Request("http://localhost/sessions/more", { method: "POST" }),
	);

	assertEquals(response.status, 204);
	assertEquals(context.store.snapshot().sessionSidebarSessions.length, 51);
	assertEquals(context.store.snapshot().sessionSidebarHasMore, false);
});

Deno.test("session images are served separately from transcript HTML", async () => {
	const context = fakeContext();
	const url = context.resources.sessionImages.register({
		data: "aW1hZ2U=",
		mimeType: "image/png",
	});
	const response = await createRouter(context).fetch(
		new Request(`http://localhost${url}`),
	);
	assertEquals(response.status, 200);
	assertEquals(response.headers.get("content-type"), "image/png");
	assertEquals(new TextDecoder().decode(await response.arrayBuffer()), "image");
});

Deno.test("native workspace picking opens directly through Datastar", async () => {
	const opened: string[] = [];
	const context = {
		openWorkspace(path: string) {
			opened.push(path);
			return Promise.resolve(path !== "/failed");
		},
	};

	const cancelled = await pickWorkspace(context, () => Promise.resolve(undefined));
	assertEquals(cancelled.status, 204);
	assertEquals(opened, []);

	const success = await pickWorkspace(context, () => Promise.resolve("/selected"));
	assertEquals(success.status, 200);
	const successBody = await success.text();
	assertStringIncludes(successBody, '"_workspacePickerError":""');
	assertStringIncludes(successBody, "workspace-dialog");
	assertStringIncludes(successBody, ".close()");
	assertEquals(opened, ["/selected"]);

	const failed = await pickWorkspace(context, () => Promise.resolve("/failed"));
	assertEquals(failed.status, 200);
	assertStringIncludes(
		await failed.text(),
		'"_workspacePickerError":"Workspace transition failed."',
	);
	assertEquals(opened, ["/selected", "/failed"]);
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
		assertStringIncludes(body, '"_filePickerOpen":true');

		const empty = await router.fetch(
			signalGet("/files/search", { fileQuery: "definitely-missing" }),
		);
		assertStringIncludes(await empty.text(), '"_filePickerOpen":false');
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

Deno.test("workspace search returns matching directories", async () => {
	const workspace = await Deno.makeTempDir();
	try {
		await Deno.mkdir(`${workspace}/alpha`);
		const context = fakeContext();
		context.store.setWorkspacePath(workspace);
		const response = await createRouter(context).fetch(
			signalGet("/workspace/search", { workspaceDraft: `${workspace}/alp` }),
		);
		assertEquals(response.status, 200);
		assertStringIncludes(await response.text(), "alpha");
	} finally {
		await Deno.remove(workspace, { recursive: true });
	}
});

Deno.test("workspace review comments are sent to the current agent session", async () => {
	let prompt = "";
	const context = fakeContext({
		host: fakeHost({
			prompt: (value: string) => {
				prompt = value;
				return Promise.resolve(true);
			},
		}),
	});
	const response = await createRouter(context).fetch(
		signalRequest("/workspace/review/submit", {
			workspaceReviewComments: {
				comments: [
					{
						body: "handle this case",
						endLine: 14,
						endSide: "additions",
						path: "src/example.ts",
						startLine: 12,
						startSide: "additions",
					},
				],
			},
		}),
	);
	assertEquals(response.status, 200);
	assertStringIncludes(await response.text(), "pi-ui-workspace-review-submitted");
	assertEquals(
		prompt,
		"address the following review comments:\n\n" +
			"1. src/example.ts:12–14\nhandle this case",
	);
});

Deno.test("workspace review comments reject malformed input", async () => {
	const response = await createRouter(fakeContext()).fetch(
		signalRequest("/workspace/review/submit", {
			workspaceReviewComments: { comments: [] },
		}),
	);
	assertEquals(response.status, 400);
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

Deno.test("multipart prompts resize valid image attachments before passing them to pi", async () => {
	let submitted:
		| {
				text: string;
				options: NonNullable<Parameters<AgentHost["prompt"]>[1]>;
		  }
		| undefined;
	const host = fakeHost({
		prompt: async (
			text: string,
			options: NonNullable<Parameters<AgentHost["prompt"]>[1]>,
		) => {
			submitted = { text, options };
			return true;
		},
	});
	const formData = new FormData();
	formData.set("prompt", "@/tmp/screenshot.png\ninspect this");
	const imageData =
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
	formData.set(
		"image",
		new File([Uint8Array.fromBase64(imageData)], "screenshot.png", {
			type: "image/png",
		}),
	);
	const response = await createRouter(fakeContext({ host })).fetch(
		new Request("http://localhost/prompt", { method: "POST", body: formData }),
	);
	assertEquals(response.status, 204);
	assertEquals(submitted, {
		text: "@/tmp/screenshot.png\ninspect this",
		options: {
			images: [{ type: "image", data: imageData, mimeType: "image/png" }],
		},
	});
});

Deno.test("multipart prompts reject HEIC images before provider submission", async () => {
	const formData = new FormData();
	formData.set("prompt", "inspect this");
	formData.set(
		"image",
		new File(["image bytes"], "screenshot.heic", { type: "image/heic" }),
	);
	const response = await createRouter(fakeContext()).fetch(
		new Request("http://localhost/prompt", { method: "POST", body: formData }),
	);
	assertEquals(response.status, 400);
	assertStringIncludes(await response.text(), "HEIC and HEIF images are not supported");
});

Deno.test("extension UI tracks the browser editor for synchronous extension reads", async () => {
	const context = fakeContext();
	const response = await createRouter(context).fetch(
		signalRequest("/extensions/ui/editor", { prompt: "current draft" }),
	);

	assertEquals(response.status, 204);
	assertEquals(context.store.promptEditorText, "current draft");
});

Deno.test("extension UI responses return to the active agent backend", async () => {
	let response:
		| { requestId: string; value: string | undefined; cancelled: boolean }
		| undefined;
	const host = fakeHost({
		respondExtensionUi: (requestId, value, cancelled) => {
			response = { requestId, value, cancelled };
			return true;
		},
	});
	const router = createRouter(fakeContext({ host }));
	const result = await router.fetch(
		signalRequest("/extensions/ui/respond", {
			extensionRequestId: "request-1",
			extensionResponse: "selected",
			extensionCancelled: false,
		}),
	);

	assertEquals(result.status, 204);
	assertEquals(response, {
		requestId: "request-1",
		value: "selected",
		cancelled: false,
	});
});

Deno.test("main stream binds a validated display client identity", async () => {
	const clientId = "123e4567-e89b-42d3-a456-426614174000";
	let connectedClientId: string | undefined;
	const context = fakeContext({
		renderer: uiRendererStub({
			createStream: (_signal: AbortSignal, receivedClientId: string) => {
				connectedClientId = receivedClientId;
				return new Response();
			},
		}),
	});
	const router = createRouter(context);
	assertEquals(
		(
			await router.fetch(
				new Request(
					`http://localhost/stream?clientId=${clientId}&appVersion=${context.appVersion}`,
				),
			)
		).status,
		200,
	);
	assertEquals(connectedClientId, clientId);
	assertEquals(
		(await router.fetch(new Request("http://localhost/stream?clientId=invalid")))
			.status,
		400,
	);
});

Deno.test("display refresh updates its connected presentation owner", async () => {
	const clientId = "123e4567-e89b-42d3-a456-426614174000";
	let measured: { clientId: string; hz: number } | undefined;
	const context = fakeContext({
		renderer: uiRendererStub({
			setDisplayRefreshHz: (receivedClientId: string, hz: number) => {
				measured = { clientId: receivedClientId, hz };
				return true;
			},
		}),
	});
	const router = createRouter(context);
	const response = await router.fetch(
		new Request("http://localhost/display-refresh", {
			method: "POST",
			headers: { "content-type": "application/json" },
			body: JSON.stringify({ clientId, hz: 120 }),
		}),
	);
	assertEquals(response.status, 204);
	assertEquals(measured, { clientId, hz: 120 });
	assertEquals(
		(
			await router.fetch(
				new Request("http://localhost/display-refresh", {
					method: "POST",
					headers: { "content-type": "application/json" },
					body: JSON.stringify({ clientId, hz: 1 }),
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
		navigateTree: async () => ({
			status: "success",
			editorText: "replacement",
		}),
	});
	const replacement = await router.fetch(treeNavigateRequest("new"));
	assertEquals(replacement.status, 200);
	assertStringIncludes(await replacement.text(), "replacement");

	resolveNavigation({ status: "success", editorText: "stale" });
	const cancelled = await first;
	assertEquals(cancelled.status, 204);
	const cancelledBody = await cancelled.text();
	assertStringExcludes(cancelledBody, '"prompt"');
});

Deno.test("file links open locally and download remotely", async () => {
	const path = await Deno.makeTempFile({ suffix: "-linked file.txt" });
	await Deno.writeTextFile(path, "linked content");
	const uri = toFileUrl(path).href;
	try {
		let openedPath: string | undefined;
		const localRouter = createRouter(
			fakeContext({
				isLocalRequest: () => true,
				openPath: (path) => {
					openedPath = path;
					return Promise.resolve();
				},
			}),
		);
		const local = await localRouter.fetch(fileOpenRequest(uri));
		assertEquals(local.status, 204);
		assertEquals(openedPath, path);

		const remote = await createRouter(fakeContext()).fetch(fileOpenRequest(uri));
		assertEquals(remote.status, 200);
		assertEquals(remote.headers.get("content-type"), "application/octet-stream");
		assertStringIncludes(
			remote.headers.get("content-disposition") ?? "",
			"attachment;",
		);
		assertEquals(await remote.text(), "linked content");
	} finally {
		await Deno.remove(path);
	}
});

Deno.test("request locality uses the connection peer address", () => {
	const address = (hostname: string): Deno.NetAddr => ({
		transport: "tcp",
		hostname,
		port: 1234,
	});
	assertEquals(isLoopbackAddress(address("127.0.0.1")), true);
	assertEquals(isLoopbackAddress(address("::1")), true);
	assertEquals(isLoopbackAddress(address("::ffff:127.0.0.1")), true);
	assertEquals(isLoopbackAddress(address("192.168.1.20")), false);
});

function uiRendererStub<Stub extends Partial<UiRenderer>>(stub: Stub): UiRenderer {
	return Object.assign(Object.create(UiRenderer.prototype), stub);
}

function fakeContext(
	overrides: {
		host?: AgentHost;
		renderer?: UiRenderer;
		openPath?: (path: string) => Promise<void>;
		isLocalRequest?: (request: Request) => boolean;
		keybindHints?: boolean;
		minimalMode?: boolean;
		toolOutputHidden?: boolean;
	} = {},
): RouteContext {
	const store = new AppStore();
	return {
		appVersion: "test-version",
		keybindHints: overrides.keybindHints ?? true,
		minimalMode: overrides.minimalMode ?? false,
		toolOutputHidden: overrides.toolOutputHidden ?? false,
		store,
		renderer:
			overrides.renderer ??
			uiRendererStub({
				createStream: () => new Response(),
				patchOlderMessages: () => {},
				renderMessagesElement: () => "<div id=messages></div>",
				enhanceMessage: () => true,
				setDisplayRefreshHz: () => true,
			}),
		resources: {
			host: overrides.host ?? fakeHost(),
			sessionImages: new SessionImageStore(),
		},
		transferredFiles: { importFiles: async () => [] },
		openWorkspace: async () => true,
		openPath: overrides.openPath ?? (async () => {}),
		isLocalRequest: overrides.isLocalRequest ?? (() => false),
		readBasecoat: async () => new ArrayBuffer(0),
		serveStatic: async () => new Response("static"),
	};
}

function fakeHost(overrides: Partial<AgentHost> = {}): AgentHost {
	return Object.assign(Object.create(AgentHost.prototype), {
		abort: async () => {},
		abortBackgroundSession: async () => true,
		closeAuth: () => {},
		closeLlama: () => {},
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
		openLlama: () => {},
		openTree: () => true,
		prompt: async () => true,
		removeQueuedMessage: async () => true,
		renameSession: async () => true,
		respondExtensionUi: () => true,
		restoreQueuedMessages: () => "",
		resumeSession: async () => ({ status: "success" }),
		setModel: async () => true,
		setThinkingLevel: async () => true,
		startLogin: () => true,
		toggleThinkingBlockVisibility: () => true,
		submitAuthInput: () => true,
		toggleLlamaModel: () => true,
		toggleScopedModel: async () => true,
		...overrides,
	});
}

function fileOpenRequest(uri: string): Request {
	return new Request("http://localhost/files/open", {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify({ uri }),
	});
}

function treeNavigateRequest(entryId: string): Request {
	return signalRequest("/tree/navigate", {
		treeEntryId: entryId,
		treeSummarize: false,
		treeSummaryInstructions: "",
	});
}

function signalGet(path: string, signals: Record<string, Jsonifiable>): Request {
	const datastar = encodeURIComponent(JSON.stringify(signals));
	return new Request(`http://localhost${path}?datastar=${datastar}`);
}

function signalRequest(path: string, signals: Record<string, Jsonifiable>): Request {
	return new Request(`http://localhost${path}`, {
		method: "POST",
		headers: { "content-type": "application/json" },
		body: JSON.stringify(signals),
	});
}
