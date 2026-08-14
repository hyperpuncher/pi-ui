import { serveDir } from "@std/http/file-server";
import { fromFileUrl } from "@std/path";

import { AgentHost } from "../agent/host.ts";
import { SessionTransitionController } from "../agent/session-transition-controller.ts";
import { setActiveCodeTheme } from "../pierre-theme.ts";
import { AppStore } from "../state/app-store.ts";
import { loadPierreLanguage } from "../ui/diffs.ts";
import { UiRenderer } from "../ui/ui-renderer.ts";
import { openWithDefaultApp } from "../utils/open-with-default-app.ts";
import { expandHomePath } from "../utils/workspace.ts";
import { readCodeThemePreference } from "./code-theme-preferences.ts";
import { DatastarClientHub } from "./datastar-client-hub.ts";
import { ExactRouter } from "./router.ts";
import { registerAssetRoutes } from "./routes/assets.ts";
import { registerAuthRoutes } from "./routes/auth.ts";
import { registerCodeThemeRoutes } from "./routes/code-theme.ts";
import type { RouteContext, RouteResources } from "./routes/context.ts";
import { registerDisplayRefreshRoutes } from "./routes/display-refresh.ts";
import { registerFileRoutes } from "./routes/files.ts";
import { registerModelRoutes } from "./routes/models.ts";
import { registerPromptRoutes } from "./routes/prompt.ts";
import { registerSessionPerformanceRoutes } from "./routes/session-performance.ts";
import { registerSessionRoutes } from "./routes/sessions.ts";
import { registerStreamRoutes } from "./routes/stream.ts";
import { registerTreeRoutes } from "./routes/tree.ts";
import { registerWorkspaceReviewRoutes } from "./routes/workspace-review.ts";
import { registerWorkspaceRoutes } from "./routes/workspace.ts";
import { SessionImageStore } from "./session-image-store.ts";
import { TransferredFileStore } from "./transferred-files.ts";

const basecoatJsPath = fromFileUrl(
	new URL("../../static/basecoat.vendor.js", import.meta.url),
);
const staticRoot = fromFileUrl(new URL("../../static", import.meta.url));

export async function createApp(): Promise<Deno.ServeDefaultExport> {
	const codeTheme = await readCodeThemePreference();
	setActiveCodeTheme(codeTheme);
	const preloadShellHighlighterPromise = loadPierreLanguage("bash");
	const localRequests = new WeakSet<Request>();
	const store = new AppStore();
	const sessionImages = new SessionImageStore();
	const renderer = new UiRenderer(store, new DatastarClientHub(), {
		registerImage: (image) => sessionImages.register(image),
		clearImages: () => sessionImages.clear(),
	});
	const transitions = new SessionTransitionController((transition) =>
		store.setSessionTransition(transition),
	);
	installUnhandledErrorReporter();
	const host = await AgentHost.create(store, undefined, {
		transitionController: transitions,
	}).catch((error: ErrorOptions["cause"]) => {
		console.error("Failed to start pi SDK runtime", error);
		return undefined;
	});
	if (!(await preloadShellHighlighterPromise)) {
		console.error("Failed to preload shell highlighter");
	}
	const resources: RouteResources = { host, sessionImages };
	const transferredFiles = await TransferredFileStore.create();
	addEventListener(
		"unload",
		() => {
			try {
				transferredFiles.disposeSync();
			} catch {
				// Best-effort only during process teardown.
			}
			// Unload cannot reliably await asynchronous runtime teardown.
			resources.host?.dispose().catch((error: ErrorOptions["cause"]) => {
				console.error("Failed to dispose pi SDK runtime during teardown", error);
			});
		},
		{ once: true },
	);

	const context: RouteContext = {
		store,
		renderer,
		resources,
		transferredFiles,
		readBasecoat: async () =>
			new Uint8Array(await Deno.readFile(basecoatJsPath)).buffer,
		serveStatic: (request) => serveDir(request, { fsRoot: staticRoot }),
		openWorkspace: (path) => openWorkspace(path, store, resources, transitions),
		openPath: openWithDefaultApp,
		isLocalRequest: (request) => localRequests.has(request),
	};
	const router = createRouter(context);
	return {
		fetch: (request, info) => {
			if (isLoopbackAddress(info.remoteAddr)) localRequests.add(request);
			const pathname = new URL(request.url).pathname;
			if (router.has(request.method, pathname)) return router.fetch(request);
			if (request.method === "GET") return context.serveStatic(request);
			return router.fetch(request);
		},
	};
}

export function isLoopbackAddress(address: Deno.Addr): boolean {
	if (address.transport !== "tcp") return true;
	const hostname = address.hostname.toLowerCase();
	return (
		hostname === "localhost" ||
		hostname === "::1" ||
		hostname === "0:0:0:0:0:0:0:1" ||
		/^127(?:\.\d{1,3}){3}$/.test(hostname) ||
		hostname.startsWith("::ffff:127.")
	);
}

export function createRouter(context: RouteContext): ExactRouter<RouteContext> {
	const router = new ExactRouter(context);
	registerAssetRoutes(router);
	registerStreamRoutes(router);
	registerDisplayRefreshRoutes(router);
	registerCodeThemeRoutes(router);
	registerPromptRoutes(router);
	registerSessionRoutes(router);
	registerSessionPerformanceRoutes(router);
	registerWorkspaceRoutes(router);
	registerWorkspaceReviewRoutes(router);
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
	const transition = await transitions.run(requestedPath, async () => {
		const realPath = await Deno.realPath(expandHomePath(requestedPath));
		if (!(await Deno.stat(realPath)).isDirectory) {
			throw new Error("Not a directory");
		}
		if (!resources.host) {
			resources.host = await AgentHost.create(store, realPath, {
				refreshWorkspaces: false,
				transitionController: transitions,
			});
			return true;
		}
		return await resources.host.openWorkspace(realPath);
	});
	return transition.status === "success";
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
