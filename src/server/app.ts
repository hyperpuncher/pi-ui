import { AgentHost } from "../agent/host.ts";
import { smokePiSdkImport } from "../agent/sdk-smoke.ts";
import { AppState } from "../state/app-state.ts";
import { renderPage } from "../ui/page.tsx";
import { sseHeaders } from "./datastar.ts";

const staticFiles = new Map([
	["/app.css", { path: "static/app.css", contentType: "text/css; charset=utf-8" }],
	["/app.js", { path: "static/app.js", contentType: "text/javascript; charset=utf-8" }],
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
				return new Response(state.createStream(request.signal), {
					headers: sseHeaders(),
				});
			}

			if (request.method === "POST" && url.pathname === "/prompt") {
				const text = await readComposer(request);
				const accepted = await host?.prompt(text);
				return sseResponse(
					`event: datastar-patch-signals\ndata: signals {"composer":""${accepted === false ? ',"lastPromptAccepted":false' : ""}}\n\n`,
				);
			}

			if (request.method === "POST" && url.pathname === "/abort") {
				await host?.abort();
				return sseResponse("event: datastar-patch-signals\ndata: signals {}\n\n");
			}

			if (request.method === "POST" && url.pathname === "/sessions/new") {
				await host?.newSession();
				return sseResponse(
					'event: datastar-patch-signals\ndata: signals {"commandOpen":false}\n\n',
				);
			}

			if (request.method === "POST" && url.pathname === "/model") {
				const modelRef = await readFormValue(request, "model");
				await host?.setModel(modelRef);
				return sseResponse("event: datastar-patch-signals\ndata: signals {}\n\n");
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

async function readFormValue(request: Request, name: string): Promise<string> {
	const contentType = request.headers.get("content-type") ?? "";
	if (contentType.includes("application/json")) {
		const body = await request.json().catch(() => ({}));
		return String(body?.datastar?.[name] ?? body?.[name] ?? "");
	}
	if (contentType.includes("form")) {
		const form = await request.formData();
		return String(form.get(name) ?? "");
	}
	return "";
}

async function readComposer(request: Request): Promise<string> {
	const contentType = request.headers.get("content-type") ?? "";
	if (contentType.includes("application/json")) {
		const body = await request.json().catch(() => ({}));
		return String(body?.datastar?.composer ?? body?.composer ?? "");
	}
	if (contentType.includes("form")) {
		const form = await request.formData();
		return String(form.get("composer") ?? "");
	}
	return await request.text();
}

function html(body: string): Response {
	return new Response(body, {
		headers: { "content-type": "text/html; charset=utf-8" },
	});
}

function sseResponse(body: string): Response {
	return new Response(body, { headers: sseHeaders() });
}

function notFound(): Response {
	return new Response("Not found", { status: 404 });
}

function formatError(error: unknown): string {
	return error instanceof Error ? error.message : String(error);
}
