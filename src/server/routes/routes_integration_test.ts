import { test } from "bun:test";
import { basename } from "node:path";
import { pathToFileURL } from "node:url";

import type { Jsonifiable } from "@starfederation/datastar-sdk/types";

import { assertEquals, assertStringIncludes } from "#testing/assertions";
import { mkdir, remove, writeFile, writeTextFile } from "#testing/files";
import { makeTempDir, makeTempFile } from "#testing/temp";

import { getToolPath } from "../../../node_modules/@earendil-works/pi-coding-agent/dist/utils/tools-manager.js";
import { AppStore } from "../../state/app-store.ts";
import { assertStringExcludes } from "../../testing/assertions.ts";
import { UiRenderer } from "../../ui/ui-renderer.ts";
import { DatastarClientHub } from "../datastar-client-hub.ts";
import { executeRoute } from "../route.ts";
import { appRoutes } from "../routes.ts";
import { SessionImageStore } from "../session-image-store.ts";
import type { RouteContext, RuntimeResource } from "./context.ts";
import { endpoints, filesPreviewBase } from "./endpoints.ts";
import { fileRoutes } from "./files.ts";

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
		context.store.setSessionCatalog([
			{
				path: "/sessions/one.jsonl",
				cwd: workspace,
				title: "One",
				messageCount: 1,
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
			messageCount: 1,
			modified: "Today",
		})),
	);
	assertEquals(context.store.snapshot().sessions.length, 30);

	const response = await createRouter(context).fetch(
		new Request("http://localhost/sessions/more", { method: "POST" }),
	);

	assertEquals(response.status, 204);
	assertEquals(context.store.snapshot().sessions.length, 51);
	assertEquals(context.store.snapshot().sessionsHasMore, false);
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

const fdPath = getToolPath("fd") ?? undefined;

test.skipIf(!fdPath)(
	"file search uses current workspace and escapes Datastar fragments",
	async () => {
		const firstWorkspace = await makeTempDir();
		const secondWorkspace = await makeTempDir();
		try {
			await writeTextFile(`${firstWorkspace}/first.txt`, "");
			await writeTextFile(`${secondWorkspace}/<unsafe>.txt`, "");
			const context = fakeContext();
			context.resources.fdPath = fdPath;
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
			assertEquals(
				(await router.fetch(signalGet("/files/search", {}))).status,
				400,
			);
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
	},
);

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
				options: NonNullable<Parameters<RuntimeResource["prompt"]>[1]>;
		  }
		| undefined;
	const host = fakeHost({
		prompt: async (
			text: string,
			options: NonNullable<Parameters<RuntimeResource["prompt"]>[1]>,
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

test("file links resolve inside and outside paths to the editor without downloading", async () => {
	const workspace = await makeTempDir();
	const name = "linked ü file.ts";
	const path = `${workspace}/${name}`;
	const outside = await makeTempFile({ suffix: "-linked ü file.ts" });
	await writeTextFile(path, "export const value = 1;");
	await writeTextFile(outside, "export const value = 1;");
	try {
		const context = fakeContext();
		context.store.setWorkspacePath(workspace);
		for (const [linkedPath, editorPath] of [
			[path, name],
			[outside, outside],
		] as const) {
			const response = await createRouter(context).fetch(
				fileOpenRequest(pathToFileURL(linkedPath).href),
			);
			assertEquals(response.status, 200);
			assertEquals(await response.json(), {
				path: editorPath,
				workspacePath: workspace,
			});
			assertEquals(response.headers.get("content-disposition"), null);
		}
	} finally {
		await remove(workspace, { recursive: true });
		await remove(outside);
	}
});

test("outside files can be read, edited and downloaded without changing workspaces", async () => {
	const workspace = await makeTempDir();
	const outside = await makeTempFile({ suffix: "-example ü.ts" });
	const context = fakeContext();
	context.store.setWorkspacePath(workspace);
	const router = createRouter(context);
	const url = `http://localhost${endpoints.workspaceFileContent}?path=${encodeURIComponent(outside)}`;
	try {
		await writeTextFile(outside, "export const value = 1;");
		const response = await router.fetch(new Request(url));
		assertEquals(response.status, 200);
		const file = await response.json();
		assertEquals(file.path, outside.replaceAll("\\", "/"));
		assertEquals(file.contents, "export const value = 1;");
		const saved = await router.fetch(
			new Request(url, {
				method: "PUT",
				headers: { "content-type": "application/json" },
				body: JSON.stringify({
					path: file.path,
					contents: "export const value = 2;",
					revision: file.revision,
				}),
			}),
		);
		assertEquals(saved.status, 200);
		assertEquals(await Bun.file(outside).text(), "export const value = 2;");
		const downloaded = await router.fetch(new Request(`${url}&download=1`));
		assertEquals(downloaded.status, 200);
		assertEquals(await downloaded.text(), "export const value = 2;");
		assertEquals(
			downloaded.headers.get("content-disposition"),
			`attachment; filename*=UTF-8''${encodeURIComponent(basename(outside))}`,
		);
		assertEquals(downloaded.headers.get("content-type"), "text/plain; charset=utf-8");
		assertEquals(context.store.workspacePath, workspace);
	} finally {
		await remove(workspace, { recursive: true });
		await remove(outside);
	}
});

test("editor downloads support binary and large files without a text preview", async () => {
	const workspace = await makeTempDir();
	const context = fakeContext();
	context.store.setWorkspacePath(workspace);
	const router = createRouter(context);
	try {
		for (const [name, bytes] of [
			["binary.bin", new Uint8Array([255, 254, 0])],
			["large.txt", new Uint8Array(2 * 1024 * 1024 + 1).fill(65)],
		] as const) {
			await writeFile(`${workspace}/${name}`, bytes);
			const response = await router.fetch(
				new Request(
					`http://localhost${endpoints.workspaceFileContent}?path=${encodeURIComponent(name)}&download=1`,
				),
			);
			assertEquals(response.status, 200);
			assertEquals(
				response.headers.get("content-disposition"),
				`attachment; filename*=UTF-8''${encodeURIComponent(name)}`,
			);

			assertEquals(await response.bytes(), bytes);
		}
	} finally {
		await remove(workspace, { recursive: true });
	}
});

test("file routes report missing files and directories", async () => {
	const workspace = await makeTempDir();
	const context = fakeContext();
	context.store.setWorkspacePath(workspace);
	const router = createRouter(context);
	try {
		for (const [path, status] of [
			[`${workspace}/missing`, 404],
			[workspace, 400],
		] as const) {
			const response = await router.fetch(
				fileOpenRequest(pathToFileURL(path).href),
			);
			assertEquals(response.status, status);
		}
		for (const [path, status] of [
			["missing", 404],
			[".", 400],
		] as const) {
			const response = await router.fetch(
				new Request(
					`http://localhost${endpoints.workspaceFileContent}?path=${encodeURIComponent(path)}&download=1`,
				),
			);
			assertEquals(response.status, status);
		}
	} finally {
		await remove(workspace, { recursive: true });
	}
});

test("HTML links render outside the workspace with relative assets", async () => {
	const workspace = await makeTempDir();
	const outsideDirectory = await makeTempDir();
	const outside = `${outsideDirectory}/My ü report.HTML`;
	const context = fakeContext();
	context.store.setWorkspacePath(workspace);
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		routes: {
			[endpoints.filesOpen]: (request) =>
				executeRoute(request, context, fileRoutes[endpoints.filesOpen].GET),
			[endpoints.filesPreview]: (request) =>
				executeRoute(request, context, fileRoutes[endpoints.filesPreview].GET),
		},
	});
	try {
		const html =
			'<!doctype html><link rel="stylesheet" href="style.css"><h1>Report</h1>';
		await writeTextFile(outside, html);
		await writeTextFile(`${outsideDirectory}/style.css`, "h1 { color: blue; }");
		const uri = pathToFileURL(outside).href + "?mode=dark#chart";
		const redirect = await fetch(
			new URL(`${endpoints.filesOpen}?uri=${encodeURIComponent(uri)}`, server.url),
			{ redirect: "manual" },
		);
		assertEquals(redirect.status, 302);
		const previewUrl = new URL(redirect.headers.get("location") ?? "", server.url);
		assertEquals(previewUrl.search, "?mode=dark");
		assertEquals(previewUrl.hash, "#chart");
		// Preview URLs keep working after the user changes workspaces.
		context.store.setWorkspacePath(outsideDirectory);
		const preview = await fetch(previewUrl);
		assertEquals(preview.status, 200);
		assertStringIncludes(preview.headers.get("content-type") ?? "", "text/html");
		assertEquals(preview.headers.get("content-disposition"), null);
		assertEquals(await preview.text(), html);
		const policy = preview.headers.get("content-security-policy") ?? "";
		assertStringIncludes(policy, "sandbox allow-scripts;");
		assertStringExcludes(policy, "allow-same-origin");
		assertStringIncludes(policy, "connect-src 'none'");
		assertStringIncludes(policy, "form-action 'none'");
		const css = await fetch(new URL("style.css", previewUrl));
		assertEquals(css.status, 200);
		assertStringIncludes(css.headers.get("content-type") ?? "", "text/css");
		assertEquals(await css.text(), "h1 { color: blue; }");
		const invalidPath = await fetch(new URL(`${filesPreviewBase}%ZZ`, server.url));
		assertEquals(invalidPath.status, 400);
		const cssUri = pathToFileURL(`${outsideDirectory}/style.css`).href;
		const nonHtml = await fetch(
			new URL(
				`${endpoints.filesOpen}?uri=${encodeURIComponent(cssUri)}`,
				server.url,
			),
		);
		assertEquals(nonHtml.status, 400);
	} finally {
		await server.stop(true);
		await remove(workspace, { recursive: true });
		await remove(outsideDirectory, { recursive: true });
	}
});

function createRouter(context: RouteContext) {
	return {
		fetch(request: Request): Promise<Response> {
			const handlers = appRoutes[new URL(request.url).pathname] ?? {};
			const handler = Object.entries(handlers).find(
				([method]) => method === request.method,
			)?.[1];
			if (!handler) throw new Error(`Unknown test route: ${request.method}`);
			return executeRoute(request, context, handler);
		},
	};
}

function uiRendererStub<Stub extends Partial<UiRenderer>>(stub: Stub): UiRenderer {
	return Object.assign(Object.create(UiRenderer.prototype), stub);
}

function fakeContext(
	overrides: {
		host?: RuntimeResource;
		renderer?: UiRenderer;
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
				setDisplayRefreshHz: () => true,
			}),
		resources: {
			host: overrides.host ?? fakeHost(),
			sessionImages: new SessionImageStore(),
		},
		transferredFiles: overrides.transferredFiles ?? { importFiles: async () => [] },
		openWorkspace: async () => true,
		serveStatic: async () => new Response("static"),
	};
}

function fakeHost(overrides: Partial<RuntimeResource> = {}): RuntimeResource {
	return {
		abort: async () => {},
		abortBackgroundSession: async () => true,
		closeAuth: () => {},
		closeLlama: () => {},
		cycleModel: async () => true,
		cycleThinkingLevel: () => true,
		deleteSession: async () => true,
		dispose: async () => {},
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
		openWorkspace: async () => true,
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
	};
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
