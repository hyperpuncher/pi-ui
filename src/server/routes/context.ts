import type { RuntimeController } from "../../agent/runtime-controller.ts";
import type { AppStore } from "../../state/app-store.ts";
import type { UiRenderer } from "../../ui/ui-renderer.ts";
import { RouteError } from "../route.ts";
import type { SessionImageStore } from "../session-image-store.ts";
import type { TransferredFileStore } from "../transferred-files.ts";

export type RouteRuntime = Pick<
	RuntimeController,
	| "abort"
	| "abortBackgroundSession"
	| "closeAuth"
	| "closeLlama"
	| "cycleModel"
	| "cycleThinkingLevel"
	| "deleteSession"
	| "forkSessionToWorkspace"
	| "getWorkspacePath"
	| "listSessions"
	| "logout"
	| "navigateTree"
	| "newSession"
	| "newTemporarySession"
	| "openLogin"
	| "openLogout"
	| "openLlama"
	| "openTree"
	| "prompt"
	| "refreshModels"
	| "removeQueuedMessage"
	| "renameSession"
	| "respondExtensionUi"
	| "restoreQueuedMessages"
	| "resumeSession"
	| "setModel"
	| "setThinkingLevel"
	| "startLogin"
	| "submitAuthInput"
	| "toggleLlamaModel"
	| "toggleScopedModel"
	| "toggleThinkingBlockVisibility"
>;

export type RuntimeResource = RouteRuntime &
	Pick<RuntimeController, "dispose" | "openWorkspace">;

export interface RouteResources {
	fdPath?: string;
	host: RuntimeResource | undefined;
	sessionImages: SessionImageStore;
}

export interface RouteContext {
	appVersion: string;
	keybindHints: boolean;
	minimalMode: boolean;
	toolOutputHidden: boolean;
	themeLab: boolean;
	store: AppStore;
	renderer: UiRenderer;
	resources: RouteResources;
	transferredFiles: Pick<TransferredFileStore, "importFiles">;
	openWorkspace(path: string): Promise<boolean>;
	serveStatic(request: Request): Promise<Response>;
}

export function requireHost(context: RouteContext): RouteRuntime {
	if (!context.resources.host) {
		throw new RouteError(503, "Session runtime unavailable.");
	}
	return context.resources.host;
}
