import type { AgentHost } from "../../agent/host.ts";
import type { AppStore } from "../../state/app-store.ts";
import type { UiRenderer } from "../../ui/ui-renderer.ts";
import { RouteError } from "../router.ts";
import type { SessionImageStore } from "../session-image-store.ts";
import type { TransferredFileStore } from "../transferred-files.ts";

export type RouteAgentHost = Pick<
	AgentHost,
	| "abort"
	| "abortBackgroundSession"
	| "closeAuth"
	| "closeLlama"
	| "cycleModel"
	| "cycleThinkingLevel"
	| "deleteSession"
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

export interface RouteResources {
	host: AgentHost | undefined;
	sessionImages: SessionImageStore;
}

export interface RouteContext {
	appVersion: string;
	keybindHints: boolean;
	store: AppStore;
	renderer: UiRenderer;
	resources: RouteResources;
	transferredFiles: Pick<TransferredFileStore, "importFiles">;
	openWorkspace(path: string): Promise<boolean>;
	openPath(path: string): Promise<void>;
	isLocalRequest(request: Request): boolean;
	readBasecoat(): Promise<ArrayBuffer>;
	serveStatic(request: Request): Promise<Response>;
}

export function requireHost(context: RouteContext): RouteAgentHost {
	if (!context.resources.host) {
		throw new RouteError(503, "Session runtime unavailable.");
	}
	return context.resources.host;
}
