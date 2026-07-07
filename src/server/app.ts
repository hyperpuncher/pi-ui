import { serveDir } from "jsr:@std/http/file-server";

import { AgentHost } from "../agent/host.ts";
import { AppState } from "../state/app-state.ts";
import { preloadMarkdownHighlighter } from "../ui/markdown.tsx";
import { renderPage } from "../ui/page.tsx";
import { renderTreePicker } from "../ui/tree-picker.tsx";
import {
	elementsAndScriptResponse,
	readSignals,
	refreshBasecoatComponentsScript,
	scriptAndSignalsResponse,
	scriptResponse,
	signalsResponse,
} from "./datastar.ts";
import { FileSearchHost } from "./file-search.ts";

const basecoatJsPath = new URL(import.meta.resolve("basecoat-css/all.min")).pathname;
const staticRoot = new URL("../../static", import.meta.url).pathname;

export async function createApp(): Promise<Deno.ServeDefaultExport> {
	await preloadMarkdownHighlighter();
	const state = new AppState();
	let host = await AgentHost.create(state).catch((error: unknown) => {
		state.appendMessage(
			"system",
			`Failed to start pi SDK runtime: ${formatError(error)}`,
		);
		return undefined;
	});
	let fileSearch = await FileSearchHost.create(state.workspacePath);

	return {
		fetch: async (request) => {
			const url = new URL(request.url);

			if (request.method === "GET" && url.pathname === "/") {
				return html(renderPage(state));
			}

			if (request.method === "GET" && url.pathname === "/stream") {
				return state.createStream(request.signal);
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
				await host?.newSession();
				return noContent();
			}

			if (request.method === "POST" && url.pathname === "/sessions/list") {
				await host?.listSessions();
				return noContent();
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
				const resumed = await host?.resumeSession(signals.sessionPath as string);
				if (!resumed || !host) {
					return noContent();
				}
				const workspacePath = host.getWorkspacePath();
				fileSearch.dispose();
				fileSearch = await FileSearchHost.create(workspacePath);
				return scriptResponse(
					"window.piUiScrollMessagesBottom?.(); document.getElementById('prompt-input')?.focus({ preventScroll: true })",
				);
			}

			if (request.method === "POST" && url.pathname === "/model") {
				const signals = await readSignals(request);
				await host?.setModel(signals.model as string);
				return noContent();
			}

			if (request.method === "POST" && url.pathname === "/thinking") {
				const signals = await readSignals(request);
				await host?.setThinkingLevel(signals.thinkingLevel as string);
				return noContent();
			}

			if (request.method === "POST" && url.pathname === "/thinking/cycle") {
				host?.cycleThinkingLevel();
				return noContent();
			}

			if (request.method === "POST" && url.pathname === "/workspace/open") {
				const signals = await readSignals(request);
				const result = await switchWorkspace(
					state,
					host,
					fileSearch,
					signals.workspacePath as string,
				);
				host = result.host;
				fileSearch = result.fileSearch;
				return noContent();
			}

			if (request.method === "GET" && url.pathname === "/files/search") {
				const query = url.searchParams.get("q") ?? "";
				return Response.json(await fileSearch.search(query));
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
		},
	};
}

async function switchWorkspace(
	state: AppState,
	host: AgentHost | undefined,
	fileSearch: FileSearchHost,
	workspacePath: string,
): Promise<{
	ok: boolean;
	host: AgentHost | undefined;
	fileSearch: FileSearchHost;
}> {
	const requestedPath = workspacePath.trim();
	if (!requestedPath) {
		return { ok: false, host, fileSearch };
	}
	try {
		const realPath = await Deno.realPath(requestedPath);
		const stat = await Deno.stat(realPath);
		if (!stat.isDirectory) {
			state.appendMessage("system", `Not a directory: ${requestedPath}`);
			return { ok: false, host, fileSearch };
		}
		host?.dispose();
		fileSearch?.dispose();
		state.resetChat();
		state.setSessions([]);
		const nextHost = await AgentHost.create(state, realPath);
		const nextFileSearch = await FileSearchHost.create(realPath);
		state.appendMessage("system", `Workspace: ${realPath}`);
		return { ok: true, host: nextHost, fileSearch: nextFileSearch };
	} catch (error) {
		state.appendMessage("system", `Failed to open workspace: ${formatError(error)}`);
		return { ok: false, host, fileSearch };
	}
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

function html(body: string): Response {
	return new Response(body, {
		headers: { "content-type": "text/html; charset=utf-8" },
	});
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
