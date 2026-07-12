import { serveDir } from "@std/http/file-server";
import { fromFileUrl } from "@std/path";

import { AgentHost } from "../agent/host.ts";
import {
	SessionTransitionController,
	type SessionTransitionResult,
} from "../agent/session-transition-controller.ts";
import { AppState } from "../state/app-state.ts";
import { preloadPierreHighlighter } from "../ui/diffs.ts";
import { renderPage } from "../ui/page.tsx";
import { renderTreePicker } from "../ui/tree-picker.tsx";
import { expandHomePath } from "../utils/workspace.ts";
import {
	elementsAndScriptResponse,
	readSignals,
	refreshBasecoatComponentsScript,
	scriptAndSignalsResponse,
	signalsResponse,
} from "./datastar.ts";
import { readDisplayRefreshUpdate } from "./display-refresh.ts";
import { FileSearchHost } from "./file-search.ts";
import {
	getTransferredFiles,
	TransferredFileError,
	TransferredFileStore,
	validateTransferContentLength,
	validateTransferredFiles,
} from "./transferred-files.ts";
import { transitionWorkspaceResources } from "./workspace-transition.ts";

const basecoatJsPath = fromFileUrl(import.meta.resolve("basecoat-css/all.min"));
const staticRoot = fromFileUrl(new URL("../../static", import.meta.url));

export async function createApp(): Promise<Deno.ServeDefaultExport> {
	const preloadHighlighterPromise = preloadPierreHighlighter();
	const state = new AppState();
	const sessionTransitions = new SessionTransitionController((transition) =>
		state.setSessionTransition(transition),
	);
	installUnhandledErrorReporter(state);
	let host = await AgentHost.create(state, undefined, {
		transitionController: sessionTransitions,
	}).catch((error: unknown) => {
		state.appendMessage(
			"system",
			`Failed to start pi SDK runtime: ${formatError(error)}`,
		);
		return undefined;
	});
	await preloadHighlighterPromise.catch((error: unknown) => {
		state.appendMessage(
			"system",
			`Failed to preload highlighter: ${formatError(error)}`,
		);
	});
	let fileSearch = await FileSearchHost.create(state.workspacePath);
	const transferredFiles = await TransferredFileStore.create();
	// unload is best-effort. An abnormal termination can leave this one owned
	// directory behind for the operating system's temporary-file cleanup.
	addEventListener(
		"unload",
		() => {
			try {
				transferredFiles.disposeSync();
			} catch {
				// Best-effort only during process teardown.
			}
		},
		{ once: true },
	);

	return {
		fetch: async (request) => {
			const url = new URL(request.url);
			try {
				if (request.method === "GET" && url.pathname === "/") {
					return html(renderPage(state));
				}

				if (request.method === "GET" && url.pathname === "/stream") {
					return state.createStream(request.signal);
				}

				if (request.method === "POST" && url.pathname === "/display-refresh") {
					const update = await readDisplayRefreshUpdate(request);
					if (!update)
						return new Response("Invalid display refresh rate", {
							status: 400,
						});
					state.setDisplayRefreshHz(update.hz);
					return noContent();
				}

				if (request.method === "POST" && url.pathname === "/prompt") {
					const signals = await readSignals(request);
					const prompt = signals.prompt as string;
					if (prompt.trim() === "/tree") {
						host?.openTree();
						return treeOpenResponse(state, { prompt: "" });
					}
					const accepted = host ? await host.prompt(prompt) : false;
					return accepted ? signalsResponse({ prompt: "" }) : noContent();
				}

				if (request.method === "POST" && url.pathname === "/auth/open-login") {
					host?.openLogin();
					return noContent();
				}

				if (request.method === "POST" && url.pathname === "/auth/open-logout") {
					host?.openLogout();
					return noContent();
				}

				if (request.method === "POST" && url.pathname === "/auth/login/start") {
					const signals = await readSignals(request);
					host?.startLogin(
						String(signals.authProvider ?? ""),
						String(signals.authType ?? ""),
					);
					return signalsResponse({ authInput: "" });
				}

				if (request.method === "POST" && url.pathname === "/auth/input") {
					const signals = await readSignals(request);
					host?.submitAuthInput(String(signals.authInput ?? ""));
					return noContent();
				}

				if (request.method === "POST" && url.pathname === "/auth/logout") {
					const signals = await readSignals(request);
					host?.logout(String(signals.authProvider ?? ""));
					return noContent();
				}

				if (request.method === "POST" && url.pathname === "/auth/close") {
					host?.closeAuth();
					return noContent();
				}

				if (request.method === "POST" && url.pathname === "/prompt/follow-up") {
					const signals = await readSignals(request);
					const accepted = host
						? await host.prompt(signals.prompt as string, {
								streamingBehavior: "followUp",
							})
						: false;
					return accepted ? signalsResponse({ prompt: "" }) : noContent();
				}

				if (request.method === "POST" && url.pathname === "/prompt/dequeue") {
					const queued = host?.restoreQueuedMessages() ?? "";
					return queued ? signalsResponse({ prompt: queued }) : noContent();
				}

				if (request.method === "POST" && url.pathname === "/abort") {
					await host?.abort();
					return noContent();
				}

				if (request.method === "POST" && url.pathname === "/sessions/new") {
					return sessionTransitionResponse(await host?.newSession());
				}

				if (
					request.method === "POST" &&
					url.pathname === "/sessions/new-temporary"
				) {
					return sessionTransitionResponse(await host?.newTemporarySession());
				}

				if (request.method === "POST" && url.pathname === "/sessions/list") {
					await host?.listSessions();
					return noContent();
				}

				if (
					request.method === "POST" &&
					url.pathname === "/sessions/background/abort"
				) {
					const signals = await readSignals(request);
					const aborted = await host?.abortBackgroundSession(
						String(signals.backgroundSessionPath ?? ""),
					);
					return aborted
						? signalsResponse({ backgroundSessionPath: "" })
						: noContent();
				}

				if (request.method === "POST" && url.pathname === "/sessions/delete") {
					const signals = await readSignals(request);
					const deleted = await host?.deleteSession(
						String(signals.sessionDeletePath ?? ""),
					);
					return deleted
						? scriptAndSignalsResponse(
								`document.getElementById('session-delete-dialog')?.close();
							${refreshBasecoatComponentsScript("#session-dialog .command")};
							document.getElementById('session-input')?.focus();`,
								{ sessionDeletePath: "", sessionDeleteTitle: "" },
							)
						: noContent();
				}

				if (request.method === "POST" && url.pathname === "/messages/older") {
					if (!state.loadOlderMessages({ broadcast: false })) {
						return noContent();
					}
					return elementsAndScriptResponse(
						state.renderMessagesElement(),
						"window.piUiRestoreMessagesAnchor?.()",
					);
				}

				if (request.method === "POST" && url.pathname === "/messages/enhance") {
					return state.enhanceMessage(url.searchParams.get("id") ?? "")
						? noContent()
						: new Response("Message is not deferred", { status: 409 });
				}

				if (request.method === "POST" && url.pathname === "/tree/open") {
					host?.openTree();
					return treeOpenResponse(state);
				}

				if (request.method === "POST" && url.pathname === "/tree/navigate") {
					const signals = await readSignals(request);
					const editorText = await host?.navigateTree(
						signals.treeEntryId as string,
						{
							summarize: signals.treeSummarize === true,
							customInstructions:
								String(signals.treeSummaryInstructions ?? "").trim() ||
								undefined,
						},
					);
					return scriptAndSignalsResponse(
						"document.getElementById('prompt-input')?.focus({ preventScroll: true })",
						{ prompt: editorText ?? "" },
					);
				}

				if (request.method === "POST" && url.pathname === "/sessions/resume") {
					const signals = await readSignals(request);
					const sessionPath = String(signals.sessionPath ?? "").trim();
					if (!sessionPath)
						return transitionErrorResponse(400, "Invalid session path.");
					if (!host)
						return transitionErrorResponse(
							503,
							"Session runtime unavailable.",
						);
					const result = await host.resumeSession(sessionPath);
					if (result.status !== "success")
						return sessionTransitionResponse(result);
					const workspacePath = host.getWorkspacePath();
					fileSearch.dispose();
					fileSearch = await FileSearchHost.create(workspacePath);
					return noContent();
				}

				if (request.method === "POST" && url.pathname === "/model") {
					const signals = await readSignals(request);
					await host?.setModel(signals.model as string);
					return noContent();
				}

				if (request.method === "POST" && url.pathname === "/model/cycle") {
					const signals = await readSignals(request);
					const direction =
						signals.modelCycleDirection === "backward"
							? "backward"
							: "forward";
					await host?.cycleModel(direction);
					return noContent();
				}

				if (
					request.method === "POST" &&
					url.pathname === "/models/scope/toggle"
				) {
					const signals = await readSignals(request);
					await host?.toggleScopedModel(signals.model as string);
					return noContent();
				}

				if (request.method === "POST" && url.pathname === "/thinking") {
					const signals = await readSignals(request);
					await host?.setThinkingLevel(signals.thinkingLevel as string);
					return noContent();
				}

				if (request.method === "POST" && url.pathname === "/thinking/cycle") {
					const signals = await readSignals(request);
					const direction =
						signals.thinkingCycleDirection === "backward"
							? "backward"
							: "forward";
					host?.cycleThinkingLevel(direction);
					return noContent();
				}

				if (request.method === "POST" && url.pathname === "/workspace/open") {
					const signals = await readSignals(request);
					const result = await switchWorkspace(
						state,
						host,
						fileSearch,
						signals.workspacePath as string,
						sessionTransitions,
					);
					host = result.host;
					fileSearch = result.fileSearch;
					return noContent();
				}

				if (request.method === "GET" && url.pathname === "/files/search") {
					const query = url.searchParams.get("q") ?? "";
					return Response.json(await fileSearch.search(query));
				}

				if (request.method === "POST" && url.pathname === "/files/import") {
					return await importTransferredFiles(request, transferredFiles);
				}

				if (request.method === "GET" && url.pathname === "/basecoat.js") {
					return new Response(await Deno.readFile(basecoatJsPath), {
						headers: { "content-type": "text/javascript; charset=utf-8" },
					});
				}

				if (
					request.method === "GET" &&
					url.pathname === "/vendor/datastar-inspector.min.js" &&
					!state.debugUi
				) {
					return notFound();
				}

				if (request.method === "GET") {
					return serveDir(request, { fsRoot: staticRoot });
				}

				return notFound();
			} catch (error) {
				state.appendMessage("system", formatError(error));
				return noContent();
			}
		},
	};
}

function installUnhandledErrorReporter(state: AppState): void {
	addEventListener("unhandledrejection", (event) => {
		event.preventDefault();
		state.appendMessage("system", formatError(event.reason));
	});
	addEventListener("error", (event) => {
		event.preventDefault();
		state.appendMessage("system", formatError(event.error ?? event.message));
	});
}

async function switchWorkspace(
	state: AppState,
	host: AgentHost | undefined,
	fileSearch: FileSearchHost,
	workspacePath: string,
	transitions: SessionTransitionController,
): Promise<{
	ok: boolean;
	host: AgentHost | undefined;
	fileSearch: FileSearchHost;
}> {
	const requestedPath = workspacePath.trim();
	if (!requestedPath) {
		return { ok: false, host, fileSearch };
	}
	let replacement: { host: AgentHost; fileSearch: FileSearchHost } | undefined;
	const transition = await transitions.run(requestedPath, async () => {
		const realPath = await Deno.realPath(expandHomePath(requestedPath));
		const stat = await Deno.stat(realPath);
		if (!stat.isDirectory) {
			throw new Error(`Not a directory: ${requestedPath}`);
		}
		const patchMessages = state.messages.length > 0;
		const openWorkspace = async () => {
			const replacement = await transitionWorkspaceResources({
				current: { host, fileSearch },
				prepareHost: () =>
					AgentHost.prepare(state, realPath, {
						patchSessionMessages: false,
						refreshWorkspaces: false,
						transitionController: transitions,
					}),
				prepareFileSearch: () => FileSearchHost.create(realPath),
				commit: ({ host: nextHost }) => {
					state.resetChat({
						preserveEmptyHint: true,
						broadcast: patchMessages,
					});
					nextHost.activate();
				},
			});
			return { ok: true, ...replacement };
		};
		replacement = patchMessages
			? await openWorkspace()
			: await state.suppressMessagePatches(openWorkspace);
		return true;
	});
	if (transition.status !== "success" || !replacement) {
		return { ok: false, host, fileSearch };
	}
	return { ok: true, ...replacement };
}

function treeOpenResponse(
	state: AppState,
	signals: Record<string, string | boolean> = {},
): Response {
	return elementsAndScriptResponse(renderTreePicker(state), openTreeScript(), signals);
}

function openTreeScript(): string {
	return `${refreshBasecoatComponentsScript("#tree-dialog .command")}; const dialog = document.getElementById('tree-dialog'); if (!dialog?.open) dialog?.showModal(); requestAnimationFrame(() => { const row = document.querySelector('[data-active-tree-row]'); row?.focus(); row?.scrollIntoView({ block: 'center' }); });`;
}

async function importTransferredFiles(
	request: Request,
	store: TransferredFileStore,
): Promise<Response> {
	const contentLengthError = validateTransferContentLength(
		request.headers.get("content-length"),
	);
	if (contentLengthError) return transferredFileErrorResponse(contentLengthError);

	// Content-Length is not guaranteed in CEF. request.formData() may therefore
	// parse the multipart body before file sizes are available; no file is copied
	// or read into an application ArrayBuffer until all parsed sizes are valid.
	const formData = await request.formData();
	const files = getTransferredFiles(formData);
	const validationError = validateTransferredFiles(files);
	if (validationError) return transferredFileErrorResponse(validationError);

	try {
		return Response.json({ paths: await store.importFiles(files) });
	} catch (error) {
		if (error instanceof TransferredFileError) {
			return transferredFileErrorResponse(error);
		}
		throw error;
	}
}

function transferredFileErrorResponse(error: {
	code: string;
	message: string;
	status: number;
}): Response {
	return Response.json(
		{ error: error.code, message: error.message },
		{ status: error.status },
	);
}

function html(body: string): Response {
	return new Response(body, {
		headers: { "content-type": "text/html; charset=utf-8" },
	});
}

export function sessionTransitionResponse(
	result: SessionTransitionResult | undefined,
): Response {
	if (!result) return transitionErrorResponse(503, "Session runtime unavailable.");
	switch (result.status) {
		case "success":
			return noContent();
		case "busy":
			return transitionErrorResponse(
				409,
				"A session transition is already running.",
			);
		case "cancelled":
			return transitionErrorResponse(422, "Session transition was cancelled.");
		case "error":
			return transitionErrorResponse(500, "Session transition failed.");
	}
}

function transitionErrorResponse(status: number, message: string): Response {
	return Response.json({ error: message }, { status });
}

function noContent(): Response {
	return new Response(null, { status: 204 });
}

function notFound(): Response {
	return new Response("Not found", { status: 404 });
}

function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
