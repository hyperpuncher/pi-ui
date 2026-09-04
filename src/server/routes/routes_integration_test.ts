import { test } from "bun:test";
import { pathToFileURL } from "node:url";

import type { Jsonifiable } from "@starfederation/datastar-sdk/types";

import { assertEquals, assertStringIncludes } from "#testing/assertions";
import { mkdir, remove, writeFile, writeTextFile } from "#testing/files";
import { makeTempDir, makeTempFile } from "#testing/temp";

import { AgentHost } from "../../agent/host.ts";
import { AppStore } from "../../state/app-store.ts";
import { assertStringExcludes } from "../../testing/assertions.ts";
import { UiRenderer } from "../../ui/ui-renderer.ts";
import { createRouter, isLoopbackAddress } from "../app.ts";
import { DatastarClientHub } from "../datastar-client-hub.ts";
import { SessionImageStore } from "../session-image-store.ts";
import type { RouteContext } from "./context.ts";
import { endpoints } from "./endpoints.ts";

test("page assets use the current immutable content version", async () => {
	const context = fakeContext();
	context.renderer = new UiRenderer(context.store, new DatastarClientHub());
	const response = await createRouter(context).fetch(new Request("http://localhost/"));
	const html = await response.text();
	assertEquals(response.headers.get("cache-control"), "no-store");
	assertStringIncludes(html, `/static/${context.appVersion}/app.css`);
	assertStringIncludes(html, `/static/${context.appVersion}/manifest.webmanifest`);
	assertStringIncludes(html, `/static/${context.appVersion}/icon-180.png`);
	assertStringIncludes(html, `appVersion=${context.appVersion}`);
	assertStringIncludes(html, " data-keybind-hints ");
	assertStringExcludes(html, " data-minimal-mode ");
	assertStringExcludes(html, 'id="theme-lab"');
	assertStringExcludes(html, "/theme-lab.css");
	assertStringExcludes(html, "/build/theme-lab.js");

	context.themeLab = true;
	const themeLabPage = await createRouter(context).fetch(
		new Request("http://localhost/"),
	);
	const themeLabHtml = await themeLabPage.text();
	assertStringIncludes(themeLabHtml, 'id="theme-lab"');
	assertStringIncludes(themeLabHtml, "/theme-lab.css");
	assertStringIncludes(themeLabHtml, "/build/theme-lab.js");

	context.keybindHints = false;
	context.minimalMode = true;
	context.toolOutputHidden = true;
	const hiddenHintsPage = await createRouter(context).fetch(
		new Request("http://localhost/"),
	);
	const quietPageHtml = await hiddenHintsPage.text();
	assertStringExcludes(quietPageHtml, " data-keybind-hints ");
	assertStringIncludes(quietPageHtml, " data-minimal-mode ");
});

test("stale main streams reload the page before connecting", async () => {
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

test("session favicons use workspace assets and fall back to a folder", async () => {
	const workspace = await makeTempDir();
	try {
		await mkdir(`${workspace}/public`);
		await writeFile(`${workspace}/public/favicon.png`, new Uint8Array([1, 2, 3]));
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
		await remove(workspace, { recursive: true });
	}
});

test("older messages use a targeted persistent-stream patch", async () => {
	let revealedCount = 0;
	const context = fakeContext({
		renderer: uiRendererStub({
			patchOlderMessages: (ids) => {
				revealedCount = ids.length;
			},
		}),
	});
	context.store.replaceMessages(
		Array.from({ length: 100 }, (_, index) => ({
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
	assertEquals(revealedCount, 30);
});

test("old messages trim only after an explicit viewport-safe request", async () => {
	let removedCount = 0;
	const context = fakeContext({
		renderer: uiRendererStub({
			messagesRemoved: (count) => {
				removedCount = count;
			},
		}),
	});
	context.store.replaceMessages(
		Array.from({ length: 180 }, (_, index) => ({
			role: "user" as const,
			text: `message ${index}`,
			timestamp: new Date(0),
		})),
	);
	for (let page = 0; page < 3; page += 1) context.store.loadOlderMessages();

	const response = await createRouter(context).fetch(
		new Request("http://localhost/messages/trim", { method: "POST" }),
	);

	assertEquals(response.status, 204);
	assertEquals(removedCount, 20);
	assertEquals(context.store.messages.length, 100);
});

test("older sessions expand backend-owned sidebar state", async () => {
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

test("session images are served separately from transcript HTML", async () => {
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

test("file search uses current workspace and escapes Datastar fragments", async () => {
	const firstWorkspace = await makeTempDir();
	const secondWorkspace = await makeTempDir();
	try {
		await writeTextFile(`${firstWorkspace}/first.txt`, "");
		await writeTextFile(`${secondWorkspace}/<unsafe>.txt`, "");
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
		assertStringIncludes(body, "&lt;unsafe&gt;.txt");
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
			remove(firstWorkspace, { recursive: true }),
			remove(secondWorkspace, { recursive: true }),
		]);
	}
});

test("workspace search returns matching directories", async () => {
	const workspace = await makeTempDir();
	try {
		await mkdir(`${workspace}/alpha`);
		const context = fakeContext();
		context.store.setWorkspacePath(workspace);
		const response = await createRouter(context).fetch(
			signalGet("/workspace/search", { workspaceDraft: `${workspace}/alp` }),
		);
		assertEquals(response.status, 200);
		assertStringIncludes(await response.text(), "alpha");
	} finally {
		await remove(workspace, { recursive: true });
	}
});

test("workspace browser lists server directories", async () => {
	const workspace = await makeTempDir();
	try {
		await mkdir(`${workspace}/alpha`);
		await mkdir(`${workspace}/beta`);
		await mkdir(`${workspace}/.hidden`);
		await writeTextFile(`${workspace}/file.txt`, "not a directory");
		const context = fakeContext();
		context.store.setWorkspacePath(workspace);
		const response = await createRouter(context).fetch(
			signalGet("/workspace/browse", {
				workspacePath: workspace,
				showHidden: false,
			}),
		);
		assertEquals(response.status, 200);
		const body = await response.text();
		assertStringIncludes(body, "Select folder");
		assertStringIncludes(body, "Open folder");
		assertStringIncludes(body, "alpha");
		assertStringIncludes(body, "beta");
		assertStringExcludes(body, ".hidden");
		assertStringExcludes(body, "file.txt");
		assertStringExcludes(body, "workspaceDraft");

		const hiddenResponse = await createRouter(context).fetch(
			signalGet("/workspace/browse", {
				workspacePath: workspace,
				showHidden: true,
			}),
		);
		assertStringIncludes(await hiddenResponse.text(), ".hidden");
	} finally {
		await remove(workspace, { recursive: true });
	}
});

test("sessions can be forked to another workspace", async () => {
	const workspace = await makeTempDir();
	let target = "";
	try {
		const context = fakeContext({
			host: fakeHost({
				forkSessionToWorkspace: async (workspacePath) => {
					target = workspacePath;
					return { status: "success" };
				},
			}),
		});
		const response = await createRouter(context).fetch(
			signalRequest(endpoints.sessionsForkToWorkspace, {
				workspacePath: workspace,
			}),
		);

		assertEquals(response.status, 204);
		assertEquals(target, workspace);
	} finally {
		await remove(workspace, { recursive: true });
	}
});

test("workspace review comments are sent to the current agent session", async () => {
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

test("workspace review comments reject malformed input", async () => {
	const response = await createRouter(fakeContext()).fetch(
		signalRequest("/workspace/review/submit", {
			workspaceReviewComments: { comments: [] },
		}),
	);
	assertEquals(response.status, 400);
});

test("malformed actions return 400 without mutating the transcript", async () => {
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

test("host-dependent actions return 503 when runtime is absent", async () => {
	const context = fakeContext();
	context.resources.host = undefined;
	const response = await createRouter(context).fetch(
		signalRequest("/prompt", { prompt: "hello" }),
	);
	assertEquals(response.status, 503);
});

test("file imports report content-detected image MIME types", async () => {
	const tempDir = await makeTempDir({ prefix: "pi-ui-image-mime-test-" });
	const path = `${tempDir}/screenshot.bin`;
	const imageData =
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
	await writeFile(path, Uint8Array.fromBase64(imageData));
	try {
		const formData = new FormData();
		formData.set("file", new File(["ignored"], "screenshot.bin"));
		const response = await createRouter(
			fakeContext({ transferredFiles: { importFiles: async () => [path] } }),
		).fetch(
			new Request("http://localhost/files/import", {
				method: "POST",
				body: formData,
			}),
		);
		assertEquals(response.status, 200);
		assertEquals(await response.json(), {
			imports: [{ path, mimeType: "image/png" }],
		});
	} finally {
		await remove(tempDir, { recursive: true });
	}
});

test("accepted prompts do not clear a newer frontend draft", async () => {
	const router = createRouter(fakeContext());
	for (const path of ["/prompt", "/prompt/follow-up"]) {
		const response = await router.fetch(signalRequest(path, { prompt: "hello" }));
		assertEquals(response.status, 204);
		assertEquals(await response.text(), "");
	}
});

test("multipart prompts resize valid image attachments before passing them to pi", async () => {
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

test("multipart prompts reject HEIC images before provider submission", async () => {
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

test("extension UI tracks the browser editor for synchronous extension reads", async () => {
	const context = fakeContext();
	const response = await createRouter(context).fetch(
		signalRequest("/extensions/ui/editor", { prompt: "current draft" }),
	);

	assertEquals(response.status, 204);
	assertEquals(context.store.promptEditorText, "current draft");
});

test("extension UI responses return to the active agent backend", async () => {
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

test("main stream binds a validated display client identity", async () => {
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

test("display refresh updates its connected presentation owner", async () => {
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

test("tree open remains repeatable and includes the fallback open effect", async () => {
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

test("tree navigation state follows mutable host ownership", async () => {
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

test("model catalog refresh delegates to the active host", async () => {
	let refreshSignal: AbortSignal | undefined;
	const router = createRouter(
		fakeContext({
			host: fakeHost({
				refreshModels: (signal) => {
					refreshSignal = signal;
					return Promise.resolve();
				},
			}),
		}),
	);

	const response = await router.fetch(
		new Request("http://localhost/models/refresh", { method: "POST" }),
	);
	assertEquals(response.status, 204);
	assertEquals(refreshSignal?.aborted, false);
});

test("file links open locally and download remotely", async () => {
	const path = await makeTempFile({ suffix: "-linked file.txt" });
	await writeTextFile(path, "linked content");
	const uri = pathToFileURL(path).href;
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
		await remove(path);
	}
});

test("request locality uses the connection peer address", () => {
	const address = (hostname: string) => ({ address: hostname });
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
		themeLab?: boolean;
		transferredFiles?: RouteContext["transferredFiles"];
	} = {},
): RouteContext {
	const store = new AppStore();
	return {
		appVersion: "test-version",
		keybindHints: overrides.keybindHints ?? true,
		minimalMode: overrides.minimalMode ?? false,
		toolOutputHidden: overrides.toolOutputHidden ?? false,
		themeLab: overrides.themeLab ?? false,
		store,
		renderer:
			overrides.renderer ??
			uiRendererStub({
				createStream: () => new Response(),
				patchOlderMessages: () => {},
				enhanceMessage: () => true,
				setDisplayRefreshHz: () => true,
			}),
		resources: {
			host: overrides.host ?? fakeHost(),
			sessionImages: new SessionImageStore(),
		},
		transferredFiles: overrides.transferredFiles ?? { importFiles: async () => [] },
		openWorkspace: async () => true,
		openPath: overrides.openPath ?? (async () => {}),
		isLocalRequest: overrides.isLocalRequest ?? (() => false),
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
		forkSessionToWorkspace: async () => ({ status: "success" }),
		getWorkspacePath: () => process.cwd(),
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
		refreshModels: async () => {},
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
