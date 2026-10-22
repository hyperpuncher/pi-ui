import { realpath, stat } from "node:fs/promises";

// pi does not publicly export its provisioner. A static import lets Bun bundle it.
import { ensureTool } from "#pi/utils/tools-manager.js";
import { type AutoTitleConfig, parseAutoTitleConfig } from "#src/agent/auto-title.ts";
import { RuntimeController } from "#src/agent/runtime-controller.ts";
import { SessionTransitionController } from "#src/agent/session-transition-controller.ts";
import {
	notifySessionDone,
	type SessionDoneNotification,
} from "#src/browser-notifications.ts";
import { defaultCodeThemes, validCodeThemes } from "#src/code-themes.ts";
import { defaultFonts, setActiveFonts, validFonts } from "#src/fonts.ts";
import { parseKeybindOverrides, setActiveKeybinds } from "#src/keybinds.ts";
import { setCodeThemes } from "#src/pierre-theme.ts";
import { ensureAppConfig } from "#src/server/app-config.ts";
import { DatastarClientHub } from "#src/server/datastar-client-hub.ts";
import type { RouteContext, RouteResources } from "#src/server/routes/context.ts";
import { SessionImageStore } from "#src/server/session-image-store.ts";
import { createStaticAssetServer } from "#src/server/static-assets.ts";
import { staticRoot } from "#src/server/static-path.ts";
import { TransferredFileStore } from "#src/server/transferred-files.ts";
import { WorkspaceReviewController } from "#src/server/workspace-review-controller.ts";
import {
	normalizeSessionSidebarPreferences,
	sessionSidebarArchiveAfterDaysDefault,
	sessionSidebarWidthDefault,
} from "#src/session-sidebar-types.ts";
import { AppStore } from "#src/state/app-store.ts";
import { loadPierreLanguage } from "#src/ui/diffs.ts";
import { UiRenderer } from "#src/ui/ui-renderer.ts";
import { checkForUpdate } from "#src/update-check.ts";
import { expandHomePath } from "#src/utils/workspace.ts";
import { normalizeWorkspaceReviewPreferences } from "#src/workspace-review-types.ts";

export async function createApp() {
	const fdReady = ensureTool("fd", ({ message }) => console.error(message));
	const staticAssets = await createStaticAssetServer(staticRoot);
	const appConfig = await ensureAppConfig();
	setActiveKeybinds(parseKeybindOverrides(appConfig.keybinds));
	const codeTheme = validCodeThemes(appConfig.codeTheme) ?? defaultCodeThemes();
	const fonts = validFonts(appConfig.fonts) ?? defaultFonts();
	const autoTitle = parseAutoTitleConfig(appConfig.autoTitle);
	const workspaceReviewPreferences = normalizeWorkspaceReviewPreferences(
		appConfig.gitView,
	);
	const sessionSidebar = normalizeSessionSidebarPreferences(appConfig.sessionSidebar);
	setCodeThemes(codeTheme);
	setActiveFonts(fonts);
	const preloadToolHighlighterPromise = loadPierreLanguage("bash");
	const store = new AppStore();
	store.theme =
		appConfig.theme === "light" || appConfig.theme === "dark"
			? appConfig.theme
			: "system";
	store.keybindHints = appConfig.keybindHints !== false;
	store.minimalMode = appConfig.minimalMode === true;
	store.toolOutputHidden = appConfig.toolOutputHidden === true;
	store.toolbarHidden = appConfig.toolbarHidden === true;
	store.sessionSidebarOpen = sessionSidebar.open !== false;
	store.sessionSidebarWidth = sessionSidebar.width ?? sessionSidebarWidthDefault;
	store.sessionSidebarArchive = sessionSidebar.archive !== false;
	store.sessionSidebarArchiveAfterDays =
		sessionSidebar.archiveAfterDays ?? sessionSidebarArchiveAfterDaysDefault;
	if (appConfig.updateCheck !== false && process.env.PI_UI_NO_UPDATE_CHECK !== "1") {
		void checkForUpdate().then((update) => {
			if (update) store.setUpdateAvailable(update);
		});
	}
	store.setWorkspaceReviewPreferences(workspaceReviewPreferences);
	const sessionImages = new SessionImageStore();
	const clientHub = new DatastarClientHub();
	const notificationClients = new DatastarClientHub();
	const onSessionDone = (details: SessionDoneNotification) =>
		notifySessionDone(notificationClients, details);
	const renderer = new UiRenderer(store, clientHub, {
		registerImage: (image) => sessionImages.register(image),
		clearImages: () => sessionImages.clear(),
	});
	const transitions = new SessionTransitionController((transition) =>
		store.setSessionTransition(transition),
	);
	const host = await RuntimeController.create(store, undefined, {
		autoTitle,
		notifySessionDone: onSessionDone,
		transitionController: transitions,
	}).catch((error: ErrorOptions["cause"]) => {
		console.error("Failed to start pi SDK runtime", error);
		return undefined;
	});
	if (!(await preloadToolHighlighterPromise)) {
		console.error("Failed to preload tool highlighter");
	}
	const workspaceReview = new WorkspaceReviewController(store);
	workspaceReview.open(store.workspacePath);
	const fdPath = await fdReady;
	const resources: RouteResources = { host, sessionImages, fdPath };
	const transferredFiles = await TransferredFileStore.create();
	const context: RouteContext = {
		store,
		renderer,
		notificationClients,
		resources,
		transferredFiles,
		appVersion: staticAssets.version,
		themeLab: process.env.PI_UI_THEME_LAB === "1",
		serveStatic: (request) => staticAssets.serve(request),
		openWorkspace: (path) =>
			openWorkspace(path, store, resources, transitions, autoTitle, onSessionDone),
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
	onSessionDone: (details: SessionDoneNotification) => void,
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
					notifySessionDone: onSessionDone,
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
