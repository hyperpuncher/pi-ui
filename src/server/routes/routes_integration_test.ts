import { test } from "bun:test";
import { mkdir, rm } from "node:fs/promises";
import { basename, join } from "node:path";
import { pathToFileURL } from "node:url";

import type { Jsonifiable } from "@starfederation/datastar-sdk/types";

import { assertEquals, assertStringIncludes } from "#testing/assertions";
import { makeTempDir, makeTempFile } from "#testing/temp";

import { getToolPath } from "../../../node_modules/@earendil-works/pi-coding-agent/dist/utils/tools-manager.js";
import { sessionSidebarWidthDefault } from "../../session-sidebar-types.ts";
import { AppStore } from "../../state/app-store.ts";
import { assertStringExcludes } from "../../testing/assertions.ts";
import { UiRenderer } from "../../ui/ui-renderer.ts";
import { DatastarClientHub } from "../datastar-client-hub.ts";
import { executeRoute } from "../route.ts";
import { appRoutes } from "../routes.ts";
import { SessionImageStore } from "../session-image-store.ts";
import type { RouteContext, RuntimeResource } from "./context.ts";
import { endpoints, filesPreviewBase, filePreviewUrl } from "./endpoints.ts";
import { fileRoutes } from "./files.ts";

test("page opts into keyboard resizing without disabling zoom", async () => {
	const context = fakeContext();
	context.renderer = new UiRenderer(context.store, new DatastarClientHub());
	const response = await createRouter(context).fetch(new Request("http://localhost/"));
	assertStringIncludes(
		await response.text(),
		'name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content"',
	);
});

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
	context.toolbarHidden = true;
	const hiddenHintsPage = await createRouter(context).fetch(
		new Request("http://localhost/"),
	);
	const quietPageHtml = await hiddenHintsPage.text();
	assertStringExcludes(quietPageHtml, " data-keybind-hints ");
	assertStringIncludes(quietPageHtml, " data-minimal-mode ");
	assertStringIncludes(quietPageHtml, " data-toolbar-hidden ");
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
		await Bun.write(`${workspace}/public/favicon.png`, new Uint8Array([1, 2, 3]));
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
		await rm(workspace, { recursive: true });
	}
});

test("previous session shortcut resumes the backend-tracked session", async () => {
	const resumed: string[] = [];
	const context = fakeContext({
		host: fakeHost({
			resumeSession: async (path) => {
				resumed.push(path);
				return { status: "success" };
			},
		}),
	});
	const router = createRouter(context);

	const empty = await router.fetch(
		new Request("http://localhost/sessions/previous", { method: "POST" }),
	);
	assertEquals(empty.status, 204);
	assertEquals(resumed, []);

	context.store.setPreviousSessionPath("/sessions/previous.jsonl");
	const response = await router.fetch(
		new Request("http://localhost/sessions/previous", { method: "POST" }),
	);
	assertEquals(response.status, 204);
	assertEquals(resumed, ["/sessions/previous.jsonl"]);
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
			await Bun.write(`${firstWorkspace}/first.txt`, "");
			// `<`, `>` and `"` are reserved characters NTFS refuses in a filename;
			// `&` and `'` still need HTML-escaping and are valid everywhere, and
			// keeping "unsafe" contiguous preserves the fuzzy-search query below.
			await Bun.write(`${secondWorkspace}/unsafe'&.txt`, "");
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
			assertStringIncludes(body, "unsafe&#x27;&amp;.txt");
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
				rm(firstWorkspace, { recursive: true }),
				rm(secondWorkspace, { recursive: true }),
			]);
		}
	},
);

test("argument completions route renders picker results from the active runtime", async () => {
	const calls: Array<{ command: string; argumentPrefix: string }> = [];
	const context = fakeContext({
		host: fakeHost({
			getArgumentCompletions: async (command, argumentPrefix) => {
				calls.push({ command, argumentPrefix });
				return [
					{
						value: "anthropic/opus",
						label: "anthropic/opus",
						description: "Opus",
					},
				];
			},
		}),
	});
	const router = createRouter(context);

	const response = await router.fetch(
		signalGet(endpoints.commandArgumentCompletions, {
			argumentCommand: "model",
			argumentPrefix: "op",
		}),
	);
	assertEquals(response.status, 200);
	assertEquals(response.headers.get("content-type"), "text/event-stream");
	assertEquals(calls, [{ command: "model", argumentPrefix: "op" }]);
	const body = await response.text();
	assertStringIncludes(body, 'id="argument-picker-results"');
	assertStringIncludes(body, "anthropic/opus");
	assertStringIncludes(body, "datastar-patch-elements");
	assertStringIncludes(body, '"_argumentPickerOpen":true');
});

test("argument completions route reports no results and requires a command", async () => {
	const context = fakeContext({
		host: fakeHost({ getArgumentCompletions: async () => [] }),
	});
	const router = createRouter(context);

	const empty = await router.fetch(
		signalGet(endpoints.commandArgumentCompletions, {
			argumentCommand: "unknown",
			argumentPrefix: "",
		}),
	);
	assertStringIncludes(await empty.text(), '"_argumentPickerOpen":false');

	assertEquals(
		(
			await router.fetch(
				signalGet(endpoints.commandArgumentCompletions, { argumentPrefix: "x" }),
			)
		).status,
		400,
	);
});

test("argument completions route returns 503 when no runtime is available", async () => {
	const context = fakeContext();
	context.resources.host = undefined;
	const router = createRouter(context);

	const response = await router.fetch(
		signalGet(endpoints.commandArgumentCompletions, {
			argumentCommand: "model",
			argumentPrefix: "",
		}),
	);
	assertEquals(response.status, 503);
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
		await rm(workspace, { recursive: true });
	}
});

test("workspace browser lists server directories", async () => {
	const workspace = await makeTempDir();
	try {
		await mkdir(`${workspace}/alpha`);
		await mkdir(`${workspace}/beta`);
		await mkdir(`${workspace}/.hidden`);
		await Bun.write(`${workspace}/file.txt`, "not a directory");
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
		assertStringIncludes(body, "New folder");
		assertStringIncludes(body, "Folder name");
		assertStringIncludes(body, "/workspace/create-folder");
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
		await rm(workspace, { recursive: true });
	}
});

test("workspace browser creates folders in the browsed directory and rejects invalid names", async () => {
	const workspace = await makeTempDir();
	try {
		await mkdir(`${workspace}/parent`);
		const context = fakeContext();
		context.store.setWorkspacePath(workspace);
		const router = createRouter(context);
		const create = (folderName: string) =>
			router.fetch(
				signalRequest("/workspace/create-folder", {
					workspacePath: `${workspace}/parent`,
					folderName,
					showHidden: false,
				}),
			);
		const response = await create("new project");
		assertEquals(response.status, 200);
		// The route reports the folder's native (backslash, on Windows) path,
		// not a `/`-joined one.
		assertStringIncludes(
			await response.text(),
			join(workspace, "parent", "new project"),
		);
		const listing = await router.fetch(
			signalGet("/workspace/browse", {
				workspacePath: `${workspace}/parent`,
				showHidden: false,
			}),
		);
		assertStringIncludes(await listing.text(), "new project");
		assertEquals(context.store.workspacePath, workspace);
		assertStringIncludes(
			await (await create("new project")).text(),
			"already exists",
		);
		for (const name of [
			"",
			"  ",
			".",
			"..",
			"../escape",
			"nested/folder",
			"nested\\folder",
			"bad\0name",
		]) {
			assertStringIncludes(
				await (await create(name)).text(),
				"Enter a folder name without slashes.",
			);
		}
	} finally {
		await rm(workspace, { recursive: true });
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
		await rm(workspace, { recursive: true });
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

test("clearing the Live Workspace activity log delegates to the runtime", async () => {
	let cleared = 0;
	const context = fakeContext({
		host: fakeHost({ clearLiveWorkspaceActivity: () => (cleared += 1) }),
	});
	const response = await createRouter(context).fetch(
		new Request("http://localhost/live-workspace/clear-activity", {
			method: "POST",
		}),
	);
	assertEquals(response.status, 204);
	assertEquals(cleared, 1);
});

test("clearing the Live Workspace activity log returns 503 when runtime is absent", async () => {
	const context = fakeContext();
	context.resources.host = undefined;
	const response = await createRouter(context).fetch(
		new Request("http://localhost/live-workspace/clear-activity", {
			method: "POST",
		}),
	);
	assertEquals(response.status, 503);
});

test("the Live Workspace activity export is a downloadable JSON snapshot of the current log", async () => {
	const context = fakeContext();
	context.store.setLiveWorkspace({
		revision: 1,
		turn: undefined,
		activeTools: [],
		queuedSteering: 0,
		queuedFollowUp: 0,
		agents: [],
		activity: [
			{
				id: "1",
				at: 500,
				kind: "retry",
				text: "Retrying (1/3)",
				background: false,
			},
		],
	});
	const response = await createRouter(context).fetch(
		new Request("http://localhost/live-workspace/activity/export"),
	);
	assertEquals(response.status, 200);
	assertStringIncludes(response.headers.get("content-disposition") ?? "", "attachment");
	const body = (await response.json()) as unknown[];
	assertEquals(body.length, 1);
});

test("the Live Workspace workflow journal route patches the panel from the current workspace", async () => {
	const home = await makeTempDir({ prefix: "pi-ui-workflow-route-test-" });
	const originalHome = process.env.HOME;
	const originalProfile = process.env.USERPROFILE;
	process.env.HOME = home;
	process.env.USERPROFILE = home;
	try {
		const context = fakeContext();
		context.store.setWorkspacePath("/workspace/no-run-yet");
		const response = await createRouter(context).fetch(
			new Request("http://localhost/live-workspace/workflow-journal"),
		);
		assertEquals(response.status, 200);
		assertStringIncludes(
			await response.text(),
			"No workflow run found for this workspace.",
		);
	} finally {
		if (originalHome === undefined) delete process.env.HOME;
		else process.env.HOME = originalHome;
		if (originalProfile === undefined) delete process.env.USERPROFILE;
		else process.env.USERPROFILE = originalProfile;
		await rm(home, { recursive: true });
	}
});

test("the Live Workspace delegate ledger route patches the panel from the delegate directory", async () => {
	const original = process.env.PI_HERDR_DELEGATE_DIR;
	process.env.PI_HERDR_DELEGATE_DIR = "/definitely/not/on/disk";
	try {
		const context = fakeContext();
		const response = await createRouter(context).fetch(
			new Request("http://localhost/live-workspace/delegate-ledger"),
		);
		assertEquals(response.status, 200);
		assertStringIncludes(await response.text(), "No delegations recorded.");
	} finally {
		if (original === undefined) delete process.env.PI_HERDR_DELEGATE_DIR;
		else process.env.PI_HERDR_DELEGATE_DIR = original;
	}
});

test("file imports report content-detected image MIME types", async () => {
	const tempDir = await makeTempDir({ prefix: "pi-ui-image-mime-test-" });
	const path = `${tempDir}/screenshot.bin`;
	const imageData =
		"iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=";
	await Bun.write(path, Uint8Array.fromBase64(imageData));
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
		await rm(tempDir, { recursive: true });
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

test("extension UI actions route to the active extension's pi_ui_event handler", async () => {
	let dispatched: unknown;
	const host = fakeHost({
		dispatchExtensionUiAction: async (request) => {
			dispatched = request;
			return true;
		},
	});
	const router = createRouter(fakeContext({ host }));
	const response = await router.fetch(
		signalRequest("/extensions/ui/action", {
			elementId: "panel",
			actionId: "submit",
			value: { note: "typed value" },
		}),
	);

	assertEquals(response.status, 204);
	assertEquals(dispatched, {
		elementId: "panel",
		actionId: "submit",
		value: { note: "typed value" },
	});
});

test("extension UI actions accept an action with no value", async () => {
	let dispatched: unknown;
	const host = fakeHost({
		dispatchExtensionUiAction: async (request) => {
			dispatched = request;
			return true;
		},
	});
	const router = createRouter(fakeContext({ host }));
	const response = await router.fetch(
		signalRequest("/extensions/ui/action", {
			elementId: "roster",
			actionId: "dismiss",
		}),
	);

	assertEquals(response.status, 204);
	assertEquals(dispatched, {
		elementId: "roster",
		actionId: "dismiss",
		value: undefined,
	});
});

test("extension UI actions reject a missing elementId without dispatching", async () => {
	let dispatched = false;
	const host = fakeHost({
		dispatchExtensionUiAction: async () => {
			dispatched = true;
			return true;
		},
	});
	const router = createRouter(fakeContext({ host }));
	const response = await router.fetch(
		signalRequest("/extensions/ui/action", { actionId: "submit" }),
	);

	assertEquals(response.status, 400);
	assertEquals(dispatched, false);
});

test("extension UI actions reject an oversized elementId without dispatching", async () => {
	let dispatched = false;
	const host = fakeHost({
		dispatchExtensionUiAction: async () => {
			dispatched = true;
			return true;
		},
	});
	const router = createRouter(fakeContext({ host }));
	const response = await router.fetch(
		signalRequest("/extensions/ui/action", {
			elementId: "x".repeat(600),
			actionId: "submit",
		}),
	);

	assertEquals(response.status, 400);
	assertEquals(dispatched, false);
});

test("extension UI actions reject an oversized value without dispatching", async () => {
	let dispatched = false;
	const host = fakeHost({
		dispatchExtensionUiAction: async () => {
			dispatched = true;
			return true;
		},
	});
	const router = createRouter(fakeContext({ host }));
	const response = await router.fetch(
		signalRequest("/extensions/ui/action", {
			elementId: "panel",
			actionId: "submit",
			value: { note: "x".repeat(70_000) },
		}),
	);

	assertEquals(response.status, 400);
	assertEquals(dispatched, false);
});

test("the client's reported color scheme reaches AppStore without needing a bound runtime", async () => {
	const context = fakeContext();
	const router = createRouter(context);
	assertEquals(context.store.clientColorScheme, "dark");

	const response = await router.fetch(
		signalRequest(endpoints.extensionUiColorScheme, { colorScheme: "light" }),
	);

	assertEquals(response.status, 204);
	assertEquals(context.store.clientColorScheme, "light");
});

test("an invalid color scheme value is rejected", async () => {
	const context = fakeContext();
	const router = createRouter(context);
	const response = await router.fetch(
		signalRequest(endpoints.extensionUiColorScheme, { colorScheme: "purple" }),
	);

	assertEquals(response.status, 400);
	assertEquals(context.store.clientColorScheme, "dark");
});

test("the client's reported viewport carries the optional prompt-column and overlay-percent hints", async () => {
	const context = fakeContext();
	const router = createRouter(context);
	assertEquals(context.store.clientViewportCells, undefined);

	const response = await router.fetch(
		signalRequest(endpoints.terminalViewport, {
			cols: 158,
			rows: 43,
			promptCols: 92,
			overlayPercentCols: 150,
			transcriptCols: 88,
		}),
	);

	assertEquals(response.status, 204);
	assertEquals(context.store.clientViewportCells, {
		columns: 158,
		rows: 43,
		promptColumns: 92,
		overlayPercentColumns: 150,
		transcriptColumns: 88,
	});
});

test("the client's reported column hints are clamped to a usable width", async () => {
	const context = fakeContext();
	const router = createRouter(context);

	const response = await router.fetch(
		signalRequest(endpoints.terminalViewport, {
			cols: 100,
			rows: 30,
			promptCols: 0,
			overlayPercentCols: 100_000,
			transcriptCols: 3,
		}),
	);

	assertEquals(response.status, 204);
	assertEquals(context.store.clientViewportCells, {
		columns: 100,
		rows: 30,
		promptColumns: 10,
		overlayPercentColumns: 500,
		transcriptColumns: 10,
	});
});

test("the client's reported viewport tolerates missing prompt-column and overlay-percent hints", async () => {
	const context = fakeContext();
	const router = createRouter(context);

	const response = await router.fetch(
		signalRequest(endpoints.terminalViewport, { cols: 100, rows: 30 }),
	);

	assertEquals(response.status, 204);
	assertEquals(context.store.clientViewportCells, {
		columns: 100,
		rows: 30,
		promptColumns: undefined,
		overlayPercentColumns: undefined,
		transcriptColumns: undefined,
	});
});

test("terminal surface input routes a raw byte sequence to the active runtime", async () => {
	let received: { surfaceId: string; data: string } | undefined;
	const host = fakeHost({
		handleTerminalSurfaceInput: (surfaceId, data) => {
			received = { surfaceId, data };
			return true;
		},
	});
	const router = createRouter(fakeContext({ host }));
	const response = await router.fetch(
		signalRequest(endpoints.terminalSurfaceInput, {
			surfaceId: "overlay-1",
			data: "\r",
		}),
	);

	assertEquals(response.status, 204);
	assertEquals(received, { surfaceId: "overlay-1", data: "\r" });
});

test("terminal surface input rejects a missing surfaceId without reaching the runtime", async () => {
	let called = false;
	const host = fakeHost({
		handleTerminalSurfaceInput: () => {
			called = true;
			return true;
		},
	});
	const router = createRouter(fakeContext({ host }));
	const response = await router.fetch(
		signalRequest(endpoints.terminalSurfaceInput, { data: "x" }),
	);

	assertEquals(response.status, 400);
	assertEquals(called, false);
});

test("terminal surface input rejects an oversized payload without reaching the runtime", async () => {
	let called = false;
	const host = fakeHost({
		handleTerminalSurfaceInput: () => {
			called = true;
			return true;
		},
	});
	const router = createRouter(fakeContext({ host }));
	const response = await router.fetch(
		signalRequest(endpoints.terminalSurfaceInput, {
			surfaceId: "overlay-1",
			data: "x".repeat(70_000),
		}),
	);

	assertEquals(response.status, 400);
	assertEquals(called, false);
});

test("terminal surface resize forwards the client-measured grid to the active runtime", async () => {
	let received: { surfaceId: string; cols: number; rows: number } | undefined;
	const host = fakeHost({
		resizeTerminalSurface: (surfaceId, cols, rows) => {
			received = { surfaceId, cols, rows };
			return true;
		},
	});
	const router = createRouter(fakeContext({ host }));
	const response = await router.fetch(
		signalRequest(endpoints.terminalSurfaceResize, {
			surfaceId: "overlay-1",
			cols: 80,
			rows: 24,
		}),
	);

	assertEquals(response.status, 204);
	assertEquals(received, { surfaceId: "overlay-1", cols: 80, rows: 24 });
});

test("terminal surface resize forwards the reporting client's id", async () => {
	let receivedClientId: string | undefined;
	const clientId = crypto.randomUUID();
	const host = fakeHost({
		resizeTerminalSurface: (_surfaceId, _cols, _rows, thisClientId) => {
			receivedClientId = thisClientId;
			return true;
		},
	});
	const router = createRouter(fakeContext({ host }));
	const response = await router.fetch(
		signalRequest(endpoints.terminalSurfaceResize, {
			surfaceId: "widget-1",
			cols: 80,
			rows: 24,
			clientId,
		}),
	);

	assertEquals(response.status, 204);
	assertEquals(receivedClientId, clientId);
});

test("terminal surface resize rejects a malformed client id without reaching the runtime", async () => {
	let called = false;
	const host = fakeHost({
		resizeTerminalSurface: () => {
			called = true;
			return true;
		},
	});
	const router = createRouter(fakeContext({ host }));
	const response = await router.fetch(
		signalRequest(endpoints.terminalSurfaceResize, {
			surfaceId: "widget-1",
			cols: 80,
			rows: 24,
			clientId: "not-a-uuid",
		}),
	);

	assertEquals(response.status, 400);
	assertEquals(called, false);
});

test("terminal surface resize rejects a negative grid size without reaching the runtime", async () => {
	let called = false;
	const host = fakeHost({
		resizeTerminalSurface: () => {
			called = true;
			return true;
		},
	});
	const router = createRouter(fakeContext({ host }));
	const response = await router.fetch(
		signalRequest(endpoints.terminalSurfaceResize, {
			surfaceId: "overlay-1",
			cols: -1,
			rows: 24,
		}),
	);

	assertEquals(response.status, 400);
	assertEquals(called, false);
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
	await Bun.write(path, "export const value = 1;");
	await Bun.write(outside, "export const value = 1;");
	try {
		const context = fakeContext();
		context.store.setWorkspacePath(workspace);
		for (const [linkedPath, editorPath] of [
			[path, name],
			// An "outside" file's reported `path` is normalized to `/`
			// separators (see the sibling "outside files can be read, edited
			// and downloaded" test), not the raw native-separator path.
			[outside, outside.replaceAll("\\", "/")],
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
		await rm(workspace, { recursive: true });
		await rm(outside);
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
		await Bun.write(outside, "export const value = 1;");
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
		await rm(workspace, { recursive: true });
		await rm(outside);
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
			await Bun.write(`${workspace}/${name}`, bytes);
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
		await rm(workspace, { recursive: true });
	}
});

test("native media previews expose metadata and byte ranges", async () => {
	const workspace = await makeTempDir();
	const context = fakeContext();
	context.store.setWorkspacePath(workspace);
	const router = createRouter(context);
	const bytes = Uint8Array.from([0, 1, 2, 3, 4, 5, 6, 7, 8, 9]);
	try {
		await Bun.write(`${workspace}/clip.mp4`, bytes);
		const url = `http://localhost${endpoints.workspaceFileContent}?path=clip.mp4`;
		const metadata = await (await router.fetch(new Request(url))).json();
		assertEquals(metadata, {
			path: "clip.mp4",
			preview: {
				kind: "video",
				mimeType: "video/mp4",
				url: `${endpoints.workspaceFileContent}?path=clip.mp4&preview=1`,
			},
			revision: `${Bun.file(`${workspace}/clip.mp4`).lastModified}:${bytes.length}`,
			size: bytes.length,
		});
		const partial = await router.fetch(
			new Request(`${url}&preview=1`, { headers: { range: "bytes=2-5" } }),
		);
		assertEquals(partial.status, 206);
		assertEquals(partial.headers.get("accept-ranges"), "bytes");
		assertEquals(partial.headers.get("content-range"), "bytes 2-5/10");
		assertEquals(partial.headers.get("content-type"), "video/mp4");
		assertEquals(await partial.bytes(), bytes.slice(2, 6));
		const suffix = await router.fetch(
			new Request(`${url}&preview=1`, { headers: { range: "bytes=-3" } }),
		);
		assertEquals(suffix.headers.get("content-range"), "bytes 7-9/10");
		assertEquals(await suffix.bytes(), bytes.slice(7));
		const invalid = await router.fetch(
			new Request(`${url}&preview=1`, { headers: { range: "bytes=10-" } }),
		);
		assertEquals(invalid.status, 416);
		assertEquals(invalid.headers.get("content-range"), "bytes */10");
	} finally {
		await rm(workspace, { recursive: true });
	}
});

test("font previews expose browser-loadable resources", async () => {
	const workspace = await makeTempDir();
	const context = fakeContext();
	context.store.setWorkspacePath(workspace);
	const router = createRouter(context);
	const bytes = Uint8Array.from([0x77, 0x4f, 0x46, 0x32]);
	try {
		await Bun.write(`${workspace}/sample.woff2`, bytes);
		const url = `http://localhost${endpoints.workspaceFileContent}?path=sample.woff2`;
		const metadata = await (await router.fetch(new Request(url))).json();
		assertEquals(metadata.preview, {
			kind: "font",
			mimeType: "font/woff2",
			url: `${endpoints.workspaceFileContent}?path=sample.woff2&preview=1`,
		});
		const preview = await router.fetch(new Request(`${url}&preview=1`));
		assertEquals(preview.headers.get("content-type"), "font/woff2");
		assertEquals(await preview.bytes(), bytes);
	} finally {
		await rm(workspace, { recursive: true });
	}
});

test("editable previews include source and sandboxed preview URLs", async () => {
	const workspace = await makeTempDir();
	const context = fakeContext();
	context.store.setWorkspacePath(workspace);
	const router = createRouter(context);
	try {
		await Bun.write(`${workspace}/vector.svg`, "<svg></svg>");
		await Bun.write(`${workspace}/page.html`, "<h1>Preview</h1>");
		await Bun.write(
			`${workspace}/README.md`,
			"# Markdown preview\n\n![Screenshot](docs/screenshot.png)",
		);
		await Bun.write(`${workspace}/docs/screenshot.png`, new Uint8Array([0x89, 0x50]));
		const svgUrl = `http://localhost${endpoints.workspaceFileContent}?path=vector.svg`;
		const svg = await (await router.fetch(new Request(svgUrl))).json();
		assertEquals(svg.contents, "<svg></svg>");
		assertEquals(svg.preview.kind, "image");
		const image = await router.fetch(new Request(`${svgUrl}&preview=1`));
		assertStringIncludes(
			image.headers.get("content-security-policy") ?? "",
			"sandbox;",
		);
		const html = await (
			await router.fetch(
				new Request(
					`http://localhost${endpoints.workspaceFileContent}?path=page.html`,
				),
			)
		).json();
		assertEquals(html.contents, "<h1>Preview</h1>");
		assertEquals(html.preview.kind, "html");
		assertStringIncludes(html.preview.url, filesPreviewBase);
		const markdown = await (
			await router.fetch(
				new Request(
					`http://localhost${endpoints.workspaceFileContent}?path=README.md`,
				),
			)
		).json();
		assertEquals(
			markdown.contents,
			"# Markdown preview\n\n![Screenshot](docs/screenshot.png)",
		);
		assertEquals(markdown.preview.kind, "markdown");
		assertEquals(
			markdown.preview.html,
			`<h1>Markdown preview</h1>\n<p><img src="${filePreviewUrl(`${workspace}/docs/screenshot.png`)}" alt="Screenshot" /></p>\n`,
		);
	} finally {
		await rm(workspace, { recursive: true });
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
		await rm(workspace, { recursive: true });
	}
});

test("HTML previews render outside the workspace with relative assets", async () => {
	const outsideDirectory = await makeTempDir();
	const outside = `${outsideDirectory}/My ü report.HTML`;
	const context = fakeContext();
	const server = Bun.serve({
		hostname: "127.0.0.1",
		port: 0,
		routes: {
			[endpoints.filesPreview]: (request) =>
				executeRoute(request, context, fileRoutes[endpoints.filesPreview].GET),
		},
	});
	try {
		const html =
			'<!doctype html><link rel="stylesheet" href="style.css"><h1>Report</h1>';
		await Bun.write(outside, html);
		await Bun.write(`${outsideDirectory}/style.css`, "h1 { color: blue; }");
		const previewUrl = new URL(filePreviewUrl(outside), server.url);
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
		assertStringIncludes(policy, "frame-ancestors 'self'");
		const css = await fetch(new URL("style.css", previewUrl));
		assertEquals(css.status, 200);
		assertStringIncludes(css.headers.get("content-type") ?? "", "text/css");
		assertEquals(await css.text(), "h1 { color: blue; }");
		const invalidPath = await fetch(new URL(`${filesPreviewBase}%ZZ`, server.url));
		assertEquals(invalidPath.status, 400);
	} finally {
		await server.stop(true);
		await rm(outsideDirectory, { recursive: true });
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
		toolbarHidden?: boolean;
		themeLab?: boolean;
		transferredFiles?: RouteContext["transferredFiles"];
	} = {},
): RouteContext {
	const store = new AppStore();
	return {
		appVersion: "test-version",
		keybindHints: overrides.keybindHints ?? true,
		minimalMode: overrides.minimalMode ?? false,
		sessionSidebarOpen: true,
		sessionSidebarWidth: sessionSidebarWidthDefault,
		toolOutputHidden: overrides.toolOutputHidden ?? false,
		toolbarHidden: overrides.toolbarHidden ?? false,
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
		clearLiveWorkspaceActivity: () => {},
		closeAuth: () => {},
		closeLlama: () => {},
		cycleModel: async () => true,
		cycleThinkingLevel: () => true,
		deleteSession: async () => true,
		dispatchExtensionUiAction: async () => true,
		dispose: async () => {},
		forgetTerminalSurfaceClient: () => {},
		forkSessionToWorkspace: async () => ({ status: "success" }),
		getArgumentCompletions: async () => [],
		getWorkspacePath: () => process.cwd(),
		handlePromptLevelInput: () => ({ consumed: false }),
		handleTerminalSurfaceInput: () => true,
		invokeExtensionShortcut: () => true,
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
		resizeTerminalSurface: () => true,
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
