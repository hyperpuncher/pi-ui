import { serveDir } from "@std/http/file-server";
import { fromFileUrl } from "@std/path";

import { AgentHost } from "../agent/host.ts";
import { SessionTransitionController } from "../agent/session-transition-controller.ts";
import { AppStore } from "../state/app-store.ts";
import { preloadPierreHighlighter } from "../ui/diffs.ts";
import { UiRenderer } from "../ui/ui-renderer.ts";
import { expandHomePath } from "../utils/workspace.ts";
import { DatastarClientHub } from "./datastar-client-hub.ts";
import { FileSearchHost } from "./file-search.ts";
import { ExactRouter } from "./router.ts";
import { registerAssetRoutes } from "./routes/assets.ts";
import { registerAuthRoutes } from "./routes/auth.ts";
import type { RouteContext, RouteResources } from "./routes/context.ts";
import { registerDisplayRefreshRoutes } from "./routes/display-refresh.ts";
import { registerFileRoutes } from "./routes/files.ts";
import { registerModelRoutes } from "./routes/models.ts";
import { registerPromptRoutes } from "./routes/prompt.ts";
import { registerSessionRoutes } from "./routes/sessions.ts";
import { registerStreamRoutes } from "./routes/stream.ts";
import { registerTreeRoutes } from "./routes/tree.ts";
import { registerWorkspaceRoutes } from "./routes/workspace.ts";
import { TransferredFileStore } from "./transferred-files.ts";
import { transitionWorkspaceResources } from "./workspace-transition.ts";

const basecoatJsPath = fromFileUrl(import.meta.resolve("basecoat-css/all.min"));
const staticRoot = fromFileUrl(new URL("../../static", import.meta.url));

export async function createApp(): Promise<Deno.ServeDefaultExport> {
	const preloadHighlighterPromise = preloadPierreHighlighter();
	const store = new AppStore();
	const renderer = new UiRenderer(store, new DatastarClientHub());
	const transitions = new SessionTransitionController((transition) =>
		store.setSessionTransition(transition),
	);
	installUnhandledErrorReporter();
	const host = await AgentHost.create(store, undefined, {
		transitionController: transitions,
	}).catch((error: unknown) => {
		console.error("Failed to start pi SDK runtime", error);
		return undefined;
	});
	await preloadHighlighterPromise.catch((error: unknown) => {
		console.error("Failed to preload highlighter", error);
	});
	const resources: RouteResources = {
		host,
		fileSearch: await FileSearchHost.create(store.workspacePath),
	};
	const transferredFiles = await TransferredFileStore.create();
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

	const context: RouteContext = {
		store,
		renderer,
		resources,
		transferredFiles,
		readBasecoat: async () =>
			(await Deno.readFile(basecoatJsPath)).buffer as ArrayBuffer,
		serveStatic: (request) => serveDir(request, { fsRoot: staticRoot }),
		openWorkspace: (path) => openWorkspace(path, store, resources, transitions),
	};
	const router = createRouter(context);
	return {
		fetch: (request) => {
			const pathname = new URL(request.url).pathname;
			if (router.has(request.method, pathname)) return router.fetch(request);
			if (request.method === "GET") return context.serveStatic(request);
			return router.fetch(request);
		},
	};
}

export function createRouter(context: RouteContext): ExactRouter<RouteContext> {
	const router = new ExactRouter(context);
	registerAssetRoutes(router);
	registerStreamRoutes(router);
	registerDisplayRefreshRoutes(router);
	registerPromptRoutes(router);
	registerSessionRoutes(router);
	registerWorkspaceRoutes(router);
	registerModelRoutes(router);
	registerAuthRoutes(router);
	registerTreeRoutes(router);
	registerFileRoutes(router);
	return router;
}

async function openWorkspace(
	workspacePath: string,
	store: AppStore,
	resources: RouteResources,
	transitions: SessionTransitionController,
): Promise<boolean> {
	const requestedPath = workspacePath.trim();
	let replacement: { host: AgentHost; fileSearch: FileSearchHost } | undefined;
	const transition = await transitions.run(requestedPath, async () => {
		const realPath = await Deno.realPath(expandHomePath(requestedPath));
		if (!(await Deno.stat(realPath)).isDirectory) throw new Error("Not a directory");
		const patchMessages = store.messages.length > 0;
		const replace = async () => {
			const next = await transitionWorkspaceResources({
				current: resources,
				prepareHost: () =>
					AgentHost.prepare(store, realPath, {
						patchSessionMessages: false,
						refreshWorkspaces: false,
						transitionController: transitions,
					}),
				prepareFileSearch: () => FileSearchHost.create(realPath),
				commit: ({ host }) => {
					store.resetChat({
						preserveEmptyHint: true,
						broadcast: patchMessages,
					});
					host.activate();
				},
			});
			replacement = next;
			return true;
		};
		return patchMessages
			? await replace()
			: await store.suppressMessagePatches(replace);
	});
	if (transition.status !== "success" || !replacement) return false;
	resources.host = replacement.host;
	resources.fileSearch = replacement.fileSearch;
	return true;
}

function installUnhandledErrorReporter(): void {
	addEventListener("unhandledrejection", (event) => {
		event.preventDefault();
		console.error("Unhandled rejection", event.reason);
	});
	addEventListener("error", (event) => {
		event.preventDefault();
		console.error("Unhandled error", event.error ?? event.message);
	});
}
