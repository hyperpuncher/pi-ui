import { realpath, stat } from "node:fs/promises";

// pi does not publicly export its provisioner. A static import lets Bun bundle it.
import { ensureTool } from "../../node_modules/@earendil-works/pi-coding-agent/dist/utils/tools-manager.js";
import { parseAutoTitleConfig, type AutoTitleConfig } from "../agent/auto-title.ts";
import { RuntimeController } from "../agent/runtime-controller.ts";
import { SessionTransitionController } from "../agent/session-transition-controller.ts";
import { defaultCodeThemes, validCodeThemes } from "../code-themes.ts";
import { defaultFonts, setActiveFonts, validFonts } from "../fonts.ts";
import { setActiveCodeTheme } from "../pierre-theme.ts";
import { AppStore } from "../state/app-store.ts";
import { loadPierreLanguage } from "../ui/diffs.ts";
import { UiRenderer } from "../ui/ui-renderer.ts";
import { expandHomePath } from "../utils/workspace.ts";
import { normalizeWorkspaceReviewPreferences } from "../workspace-review-types.ts";
import { ensureAppConfig } from "./app-config.ts";
import { DatastarClientHub } from "./datastar-client-hub.ts";
import type { RouteContext, RouteResources } from "./routes/context.ts";
import { SessionImageStore } from "./session-image-store.ts";
import { createStaticAssetServer } from "./static-assets.ts";
import { staticRoot } from "./static-path.ts";
import { TransferredFileStore } from "./transferred-files.ts";
import { WorkspaceReviewController } from "./workspace-review-controller.ts";

export async function createApp() {
	const fdReady = ensureTool("fd", ({ message }) => console.error(message));
	const staticAssets = await createStaticAssetServer(staticRoot);
	const appConfig = await ensureAppConfig();
	const codeTheme = validCodeThemes(appConfig.codeTheme) ?? defaultCodeThemes();
	const fonts = validFonts(appConfig.fonts) ?? defaultFonts();
	const autoTitle = parseAutoTitleConfig(appConfig.autoTitle);
	const workspaceReviewPreferences = normalizeWorkspaceReviewPreferences(
		appConfig.gitView,
	);
	setActiveCodeTheme(codeTheme);
	setActiveFonts(fonts);
	const preloadShellHighlighterPromise = loadPierreLanguage("bash");
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
	const host = await RuntimeController.create(store, undefined, {
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
	const fdPath = await fdReady;
	const resources: RouteResources = { host, sessionImages, fdPath };
	const transferredFiles = await TransferredFileStore.create();
	const context: RouteContext = {
		store,
		renderer,
		resources,
		transferredFiles,
		appVersion: staticAssets.version,
		keybindHints: appConfig.keybindHints !== false,
		minimalMode: appConfig.minimalMode === true,
		toolOutputHidden: appConfig.toolOutputHidden === true,
		themeLab: process.env.PI_UI_THEME_LAB === "1",
		serveStatic: (request) => staticAssets.serve(request),
		openWorkspace: (path) =>
			openWorkspace(path, store, resources, transitions, autoTitle),
	};
	let disposal: Promise<void> | undefined;
	return {
		context,
		dispose: () => {
			disposal ??= (async () => {
				workspaceReview.dispose();
				await Promise.allSettled([
					transferredFiles.dispose(),
					resources.host?.dispose(),
				]);
			})();
			return disposal;
		},
	};
}

async function openWorkspace(
	workspacePath: string,
	store: AppStore,
	resources: RouteResources,
	transitions: SessionTransitionController,
	autoTitle: AutoTitleConfig,
): Promise<boolean> {
	const requestedPath = workspacePath.trim();
	const transition = await transitions.run(
		requestedPath,
		async () => {
			const realPath = await realpath(expandHomePath(requestedPath));
			if (!(await stat(realPath)).isDirectory()) {
				throw new Error("Not a directory");
			}
			if (!resources.host) {
				resources.host = await RuntimeController.create(store, realPath, {
					autoTitle,
					refreshWorkspaces: false,
					transitionController: transitions,
				});
				return true;
			}
			return await resources.host.openWorkspace(realPath);
		},
		{ overlay: false },
	);
	return transition.status === "success";
}
