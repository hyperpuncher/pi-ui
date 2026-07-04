import { AgentHost } from "../agent/host.ts";
import { smokePiSdkImport } from "../agent/sdk-smoke.ts";
import { AppState } from "../state/app-state.ts";
import { renderPage } from "../ui/page.tsx";
import { readSignalString, signalsResponse } from "./datastar.ts";

const basecoatJsPath = new URL(import.meta.resolve("basecoat-css/all.min")).pathname;

const staticFiles = new Map([
	["/app.css", { path: "static/app.css", contentType: "text/css; charset=utf-8" }],
	["/app.js", { path: "static/app.js", contentType: "text/javascript; charset=utf-8" }],
	[
		"/datastar.js",
		{
			path: "static/vendor/datastar.js",
			contentType: "text/javascript; charset=utf-8",
		},
	],
	[
		"/basecoat.js",
		{
			path: basecoatJsPath,
			contentType: "text/javascript; charset=utf-8",
		},
	],
]);

export async function createApp(): Promise<Deno.ServeDefaultExport> {
	const state = new AppState();
	const host = await AgentHost.create(state).catch((error: unknown) => {
		state.appendMessage(
			"system",
			`Failed to start pi SDK runtime: ${formatError(error)}`,
		);
		state.setStatus("Pi SDK startup failed");
		return undefined;
	});

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
				const text = await readSignalString(request, "composer");
				const accepted = host ? await host.prompt(text) : false;
				return signalsResponse(
					accepted ? { composer: "" } : { lastPromptAccepted: false },
				);
			}

			if (request.method === "POST" && url.pathname === "/abort") {
				await host?.abort();
				return signalsResponse({});
			}

			if (request.method === "POST" && url.pathname === "/sessions/new") {
				await host?.newSession();
				return signalsResponse({ commandOpen: false });
			}

			if (request.method === "POST" && url.pathname === "/sessions/list") {
				await host?.listSessions();
				return signalsResponse({ sessionOpen: true, sessionQuery: "" });
			}

			if (request.method === "POST" && url.pathname === "/sessions/resume") {
				const sessionPath = await readSignalString(request, "sessionPath");
				await host?.resumeSession(sessionPath);
				return signalsResponse({ sessionOpen: false, sessionPath: "" });
			}

			if (request.method === "POST" && url.pathname === "/model") {
				const modelRef = await readSignalString(request, "model");
				await host?.setModel(modelRef);
				return signalsResponse({ model: state.currentModel ?? "" });
			}

			if (request.method === "GET" && url.pathname === "/debug/pi-sdk") {
				return Response.json(await smokePiSdkImport());
			}

			const staticFile = staticFiles.get(url.pathname);
			if (request.method === "GET" && staticFile) {
				try {
					return new Response(await Deno.readFile(staticFile.path), {
						headers: { "content-type": staticFile.contentType },
					});
				} catch {
					return notFound();
				}
			}

			return notFound();
		},
	};
}

function html(body: string): Response {
	return new Response(body, {
		headers: { "content-type": "text/html; charset=utf-8" },
	});
}

function notFound(): Response {
	return new Response("Not found", { status: 404 });
}

function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
