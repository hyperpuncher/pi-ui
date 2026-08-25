import { fromFileUrl } from "@std/path";

import { AgentHost } from "../agent/host.ts";
import { SessionTransitionController } from "../agent/session-transition-controller.ts";
import { setActiveFonts } from "../fonts.ts";
import { setActiveCodeTheme } from "../pierre-theme.ts";
import { AppStore } from "../state/app-store.ts";
import { loadPierreLanguage } from "../ui/diffs.ts";
import { UiRenderer } from "../ui/ui-renderer.ts";
import { openWithDefaultApp } from "../utils/open-with-default-app.ts";
import { expandHomePath } from "../utils/workspace.ts";
import { ensureAppConfig } from "./app-config.ts";
import { readAutoTitleConfig } from "./auto-title-config.ts";
import { readCodeThemePreference } from "./code-theme-preferences.ts";
import { DatastarClientHub } from "./datastar-client-hub.ts";
import { readFontPreferences } from "./font-preferences.ts";
import { ExactRouter } from "./router.ts";
import { registerAssetRoutes } from "./routes/assets.ts";
import { registerAuthRoutes } from "./routes/auth.ts";
import { registerCodeThemeRoutes } from "./routes/code-theme.ts";
import type { RouteContext, RouteResources } from "./routes/context.ts";
import { registerDisplayPreferenceRoutes } from "./routes/display-preferences.ts";
import { registerDisplayRefreshRoutes } from "./routes/display-refresh.ts";
import { registerExtensionUiRoutes } from "./routes/extension-ui.ts";
import { registerFileRoutes } from "./routes/files.ts";
import { registerFontRoutes } from "./routes/fonts.ts";
import { registerKeybindHintRoutes } from "./routes/keybind-hints.ts";
import { registerLlamaRoutes } from "./routes/llama.ts";
import { registerModelRoutes } from "./routes/models.ts";
import { registerPromptRoutes } from "./routes/prompt.ts";
import { registerSessionPerformanceRoutes } from "./routes/session-performance.ts";
import { registerSessionRoutes } from "./routes/sessions.ts";
import { registerStreamRoutes } from "./routes/stream.ts";
import { registerTreeRoutes } from "./routes/tree.ts";
import { registerWorkspaceReviewRoutes } from "./routes/workspace-review.ts";
import { registerWorkspaceRoutes } from "./routes/workspace.ts";
import { SessionImageStore } from "./session-image-store.ts";
import { createStaticAssetServer } from "./static-assets.ts";
import { TransferredFileStore } from "./transferred-files.ts";
import { WorkspaceReviewController } from "./workspace-review-controller.ts";
import { readWorkspaceReviewPreferences } from "./workspace-review-preferences.ts";

const basecoatJsPath = fromFileUrl(
	new URL("../../static/basecoat.vendor.js", import.meta.url),
);
const staticRoot = fromFileUrl(new URL("../../static", import.meta.url));

export async function createApp(): Promise<Deno.ServeDefaultExport> {
	const staticAssets = await createStaticAssetServer(staticRoot);
	const appConfig = await ensureAppConfig();
	const [codeTheme, fonts, autoTitle, workspaceReviewPreferences] = await Promise.all([
		readCodeThemePreference(),
		readFontPreferences(),
		readAutoTitleConfig(),
		readWorkspaceReviewPreferences(),
	]);
	setActiveCodeTheme(codeTheme);
	setActiveFonts(fonts);
	const preloadShellHighlighterPromise = loadPierreLanguage("bash");
	const localRequests = new WeakSet<Request>();
	const store = new AppStore();
	store.setWorkspaceReviewPreferences(workspaceReviewPreferences);
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
		autoTitle,
		transitionController: transitions,
	}).catch((error: ErrorOptions["cause"]) => {
		console.error("Failed to start pi SDK runtime", error);
		return undefined;
	});
	if (!(await preloadShellHighlighterPromise)) {
		console.error("Failed to preload shell highlighter");
	}
	const workspaceReview = new WorkspaceReviewController(store);
	workspaceReview.open(store.workspacePath);
	const resources: RouteResources = { host, sessionImages };
	const transferredFiles = await TransferredFileStore.create();
	addEventListener(
		"unload",
		() => {
			workspaceReview.dispose();
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
		appVersion: staticAssets.version,
		keybindHints: appConfig.keybindHints !== false,
		minimalMode: appConfig.minimalMode === true,
		toolOutputHidden: appConfig.toolOutputHidden === true,
		readBasecoat: async () =>
			new Uint8Array(await Deno.readFile(basecoatJsPath)).buffer,
		serveStatic: (request) => staticAssets.serve(request),
		openWorkspace: (path) =>
			openWorkspace(path, store, resources, transitions, autoTitle),
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
	registerExtensionUiRoutes(router);
	registerCodeThemeRoutes(router);
	registerFontRoutes(router);
	registerKeybindHintRoutes(router);
	registerPromptRoutes(router);
	registerSessionRoutes(router);
	registerSessionPerformanceRoutes(router);
	registerWorkspaceRoutes(router);
	registerWorkspaceReviewRoutes(router);
	registerDisplayPreferenceRoutes(router);
	registerModelRoutes(router);
	registerAuthRoutes(router);
	registerLlamaRoutes(router);
	registerTreeRoutes(router);
	registerFileRoutes(router);
	return router;
}

async function openWorkspace(
	workspacePath: string,
	store: AppStore,
	resources: RouteResources,
	transitions: SessionTransitionController,
	autoTitle: Awaited<ReturnType<typeof readAutoTitleConfig>>,
): Promise<boolean> {
	const requestedPath = workspacePath.trim();
	const transition = await transitions.run(requestedPath, async () => {
		const realPath = await Deno.realPath(expandHomePath(requestedPath));
		if (!(await Deno.stat(realPath)).isDirectory) {
			throw new Error("Not a directory");
		}
		if (!resources.host) {
			resources.host = await AgentHost.create(store, realPath, {
				autoTitle,
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
